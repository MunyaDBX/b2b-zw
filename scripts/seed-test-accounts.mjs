// Creates test users, three companies, team roles and sample posts through the
// public API (anon key from .env), exactly as the app would. Safe to re-run.
// Requires "Confirm email" OFF in Supabase (Authentication → Sign In / Providers → Email).
//
//   npm run seed
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY || KEY.startsWith('paste')) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env first.');
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD || 'Test12345';

const COMPANIES = [
  {
    name: 'Buyer Mining (Test)',
    reg: 'TEST-BUYER-001',
    type: 'buyer',
    city: 'Harare',
    admin: ['admin@buyer.test', 'Bella Buyer'],
    members: [
      ['po@buyer.test', 'Peter Procurement', 'procurement_officer'],
      ['finance@buyer.test', 'Fiona Finance', 'finance_approver'],
    ],
    rules: { approval_required_types: ['rfq_procurement'], finance_approval_threshold: 5000 },
  },
  {
    name: 'Supplier Co (Test)',
    reg: 'TEST-SUPPLIER-001',
    type: 'supplier',
    city: 'Bulawayo',
    admin: ['admin@supplier.test', 'Sam Supplier'],
    members: [
      ['sales@supplier.test', 'Sally Sales', 'procurement_officer'],
      ['finance@supplier.test', 'Frank Finance', 'finance_approver'],
    ],
  },
  {
    name: 'Haulage Ltd (Test)',
    reg: 'TEST-HAULAGE-001',
    type: 'logistics_provider',
    city: 'Mutare',
    admin: ['admin@haulage.test', 'Harry Haulage'],
    members: [
      ['dispatch@haulage.test', 'Dee Dispatch', 'logistics_manager'],
      ['driver@haulage.test', 'Danny Driver', 'driver'],
    ],
  },
];

const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (what, error) => {
  throw new Error(`${what}: ${error.message}`);
};

/** Signs in, creating the account first if it doesn't exist. Returns a client acting as that user. */
async function login(email, fullName) {
  const sb = client();
  let { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) {
    const up = await sb.auth.signUp({ email, password: PASSWORD, options: { data: { full_name: fullName } } });
    if (up.error) fail(`Sign up ${email}`, up.error);
    if (!up.data.session) {
      throw new Error(`${email} was created but needs email confirmation. Turn off "Confirm email" in Supabase and re-run.`);
    }
    console.log(`  + created ${email}`);
    data = up.data;
  } else {
    console.log(`  = ${email} already exists`);
  }
  return { sb, userId: data.user.id };
}

async function seedCompany(c) {
  console.log(`\n${c.name}`);
  // Every member must exist before the admin can add them.
  for (const [email, name] of c.members) await login(email, name);
  const { sb, userId } = await login(...c.admin);

  const mine = await sb.from('company_users').select('company_id, companies(company_name)').eq('user_id', userId).eq('role', 'admin');
  if (mine.error) fail('Read memberships', mine.error);
  let companyId = mine.data.find((m) => m.companies?.company_name === c.name)?.company_id;
  if (!companyId) {
    const r = await sb.rpc('create_company', { p_name: c.name, p_registration_number: c.reg, p_type: c.type, p_head_office_city: c.city });
    if (r.error) fail(`Create ${c.name}`, r.error);
    companyId = r.data;
    console.log(`  + company created`);
  }

  const team = await sb.rpc('list_company_members', { p_company: companyId });
  if (team.error) fail('List members', team.error);
  const have = new Set(team.data.map((m) => m.email.toLowerCase()));
  for (const [email, , role] of c.members) {
    if (have.has(email)) continue;
    const r = await sb.rpc('add_company_member', { p_company: companyId, p_email: email, p_role: role });
    if (r.error) fail(`Add ${email}`, r.error);
    console.log(`  + added ${email} as ${role}`);
  }

  if (c.rules) {
    const r = await sb.from('companies').update(c.rules).eq('id', companyId);
    if (r.error) fail('Set approval rules', r.error);
    console.log(`  = approval rules: ${c.rules.approval_required_types.join(', ')}; finance above ${c.rules.finance_approval_threshold}`);
  }
  return companyId;
}

/** Posts a listing as `email` unless one with the same title already exists. */
async function post(email, name, companyId, listing) {
  const { sb } = await login(email, name);
  const exists = await sb.from('b2b_listings').select('id').eq('company_id', companyId).eq('title', listing.title).limit(1);
  if (exists.error) fail('Check listings', exists.error);
  if (exists.data.length) return console.log(`  = "${listing.title}" already posted`);
  const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
  const r = await sb.rpc('create_listing', {
    p_company: companyId,
    p_listing: { currency: 'USD', ...listing, bidding_closes_at: days(listing.days ?? 7), days: undefined, contact_email: email },
  });
  if (r.error) fail(`Post "${listing.title}"`, r.error);
  console.log(`  + "${listing.title}" → ${r.data.approval_status}`);
}

const [buyer, supplier] = [await seedCompany(COMPANIES[0]), await seedCompany(COMPANIES[1])];
await seedCompany(COMPANIES[2]);

console.log('\nSample posts');
// Waits in Approvals (RFQs need approval at Buyer Mining, and $12,000 is above the $5,000 limit).
await post('po@buyer.test', 'Peter Procurement', buyer, {
  listing_type: 'rfq_procurement',
  title: '500 tonnes of ammonium nitrate',
  category: 'Mining consumables',
  description: 'Delivered to Bindura mine site, monthly call-offs.',
  budget_or_target_price: 12000,
  payment_terms: 'net_30',
  delivery_location: 'Bindura',
});
// Goes live immediately and can be bid on by Supplier Co.
await post('po@buyer.test', 'Peter Procurement', buyer, {
  listing_type: 'rfq_procurement',
  title: 'Safety boots and PPE, 200 sets',
  category: 'PPE',
  budget_or_target_price: 3000,
  payment_terms: 'net_30',
  delivery_location: 'Harare',
});
// Supplier Co has no rules, so its auction is live straight away.
await post('sales@supplier.test', 'Sally Sales', supplier, {
  listing_type: 'asset_auction',
  title: 'Surplus 250 kVA generator',
  category: 'Equipment',
  budget_or_target_price: 8000,
  reserve_price: 9500,
  payment_terms: 'escrow',
  delivery_location: 'Bulawayo',
  days: 5,
});

console.log(`\nDone. Every account's password is ${PASSWORD}`);
console.log('To make admin@buyer.test a platform operator, run in the Supabase SQL Editor:');
console.log("  insert into platform_admins (user_id) select id from auth.users where email = 'admin@buyer.test' on conflict do nothing;");
