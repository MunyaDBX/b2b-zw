/**
 * escrow-settlement — the only path by which escrow money states change.
 *
 *   POST /escrow-settlement/webhook  Payment rail callback (HMAC-SHA256 signed).
 *   POST /escrow-settlement/drain    Processes queued outbox events (cron, Bearer CRON_SECRET).
 *
 * Uses the service role, so all state changes go through escrow_transition(),
 * which enforces the escrow state machine and writes the audit trail.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { providerFromEnv, type EscrowRef } from '../_shared/payments.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const provider = providerFromEnv();
const TOPICS = ['escrow.funding_requested', 'escrow.release_requested'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function transition(escrowId: string, to: string, reference?: string) {
  const { error } = await supabase.rpc('escrow_transition', { p_escrow: escrowId, p_to: to, p_reference: reference });
  if (error) throw new Error(`escrow_transition(${escrowId} → ${to}): ${error.message}`);
}

// ---- Webhook ---------------------------------------------------------------
interface WebhookBody {
  escrow_id: string;
  event: 'payment.succeeded' | 'payment.refunded';
  reference: string;
}

async function handleWebhook(req: Request): Promise<Response> {
  const secret = Deno.env.get('PAYMENT_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Webhook secret not configured' }, 500);
  const raw = await req.text();
  const given = req.headers.get('x-signature') ?? '';
  if (!timingSafeEqual(given, await hmacHex(secret, raw))) return json({ error: 'Invalid signature' }, 401);

  let body: WebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.escrow_id || !body.reference) return json({ error: 'escrow_id and reference are required' }, 400);

  const to = body.event === 'payment.succeeded' ? 'funded' : body.event === 'payment.refunded' ? 'refunded' : null;
  if (!to) return json({ error: `Unsupported event ${body.event}` }, 400);
  try {
    await transition(body.escrow_id, to, body.reference); // idempotent on retries
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 409);
  }
}

// ---- Outbox drain -------------------------------------------------------------
interface OutboxEvent {
  id: number;
  topic: string;
  payload: Record<string, string>;
}

async function processEvent(ev: OutboxEvent): Promise<void> {
  if (ev.topic === 'escrow.funding_requested') {
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select('id, amount, currency, payer_company_id, payee_company_id, status')
      .eq('invoice_id', ev.payload.invoice_id)
      .single();
    if (error) throw new Error(error.message);
    if (data.status !== 'pending_funding') return;
    const { reference } = await provider.requestFunding(data as EscrowRef);
    const { error: upd } = await supabase.from('escrow_transactions').update({ provider_reference: reference }).eq('id', data.id);
    if (upd) throw new Error(upd.message);
    return;
  }

  if (ev.topic === 'escrow.release_requested') {
    // Release only escrows whose condition matches what actually happened.
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select('id, amount, currency, payer_company_id, payee_company_id, status, release_condition')
      .eq('listing_id', ev.payload.listing_id)
      .eq('status', 'funded')
      .eq('release_condition', ev.payload.reason);
    if (error) throw new Error(error.message);
    for (const e of data ?? []) {
      const { reference } = await provider.payout(e as EscrowRef);
      await transition(e.id, 'released', reference);
    }
    return;
  }
}

async function handleDrain(req: Request): Promise<Response> {
  const secret = Deno.env.get('CRON_SECRET');
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) return json({ error: 'Unauthorized' }, 401);

  const { data: events, error } = await supabase.rpc('claim_outbox_events', { p_topics: TOPICS, p_limit: 25 });
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const ev of (events ?? []) as OutboxEvent[]) {
    try {
      await processEvent(ev);
      await supabase.rpc('complete_outbox_event', { p_id: ev.id });
      results.push({ id: ev.id, ok: true });
    } catch (e) {
      const message = (e as Error).message;
      await supabase.rpc('complete_outbox_event', { p_id: ev.id, p_error: message });
      results.push({ id: ev.id, ok: false, error: message });
    }
  }
  return json({ processed: results.length, results });
}

Deno.serve((req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const path = new URL(req.url).pathname;
  if (path.endsWith('/webhook')) return handleWebhook(req);
  if (path.endsWith('/drain')) return handleDrain(req);
  return json({ error: 'Not found' }, 404);
});
