# B2B ZW

An industrial operating system for procurement, auctions, freight, plant hire, storage, agri off-take and trade finance.

Stack: Expo SDK 52 (Router v4) · TypeScript strict · NativeWind v4 · Supabase · TanStack Query v5 · Zustand · React Hook Form + Zod.

## Quick start

```bash
npm install
cp .env.example .env                 # Supabase URL + anon key
supabase start && supabase db reset  # applies supabase/migrations
npm run db:types                     # regenerates src/types/database.ts from the live schema
npm start
```

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` in strict mode |
| `npm run test:db` | Throwaway Postgres → stub + migrations → 47 security and workflow assertions |
| `npm run db:types` | Catalog-driven type generation (`scripts/gen-db-types.py`; needs only `psql`, not Docker). Set `DATABASE_URL` to point elsewhere. |

## Architecture

```
app/                       Expo Router screens
  (auth)/sign-in           email + password
  (app)/feed               FlashList marketplace, filter by vertical
  (app)/post, post/[type]  vertical picker → config-driven form
  (app)/listing/[id]       one detail screen; panels by vertical and state
  (app)/approvals          multi-tier approval inbox
  (app)/jobs               carrier and driver dispatch board
  (app)/finance/*          invoices, escrow, factoring requests, operator review queue
  (app)/company/*          team, branches, company switcher, commute routes
src/features/listings/verticals.ts   ONE config per vertical: fields → Zod schema → form → detail view
src/features/*/api.ts                TanStack Query hooks (all writes go through RLS or RPCs)
supabase/migrations/                 schema, RLS, workflows (see below)
supabase/functions/escrow-settlement Edge Function: payment webhooks and outbox worker
supabase/tests/                      SQL test suite (npm run test:db)
```

Adding a vertical takes three steps:
1. Add a detail table and its `enforce_detail_listing_type` trigger.
2. Add a case to `internal.detail_table()`.
3. Add an entry to `VERTICALS`.

The form, validation and detail view follow automatically.

## Security model

All rules are enforced in Postgres. The app's `hasRole()` only decides what to show.

- **Tenancy:** every table has RLS. Helpers (`is_company_member`, `has_company_role`) are `SECURITY DEFINER` with an empty `search_path`. `admin` implies every role.
- **Listings:** created as `draft` through `create_listing()`, which inserts the listing and its details atomically and strips any workflow fields the client sends. `submit_listing_for_approval()` builds the steps:
  - procurement review, unless the submitter is procurement
  - finance sign-off when the budget is above the company threshold or terms are escrow
  - admin sign-off for asset disposals
- **Approvals:** `decide_approval()` enforces step order and segregation of duties. Nobody approves their own listing.
- **Sealed bids:** a vendor sees only its own proposal. The buyer sees only a count (`rfq_bid_count`) until close, then all proposals. Bids lock at close. One winner per listing (partial unique index).
- **Auctions:** bids must rise and the seller cannot bid. Bids on a listing are processed one at a time under a row lock. The reserve lives in `listing_reserves`, which only the seller can read; bidders see only `auction_reserve_met()`.
- **Freight:** `posted → assigned → loaded → in_transit → delivered`. Awarding a job assigns the carrier. The carrier assigns one of its own drivers. Delivery requires an ePoD uploaded by the carrier.
- **Money:** escrow moves only through `escrow_transition()`, which only `service_role` can call. It enforces the state machine, is idempotent for webhook retries, and logs to both parties' audit logs. Trade-finance decisions are made only by `platform_admins`.
- **Audit:** append-only. Triggers on the core tables, plus explicit entries from every RPC.
- **Membership:** admins add existing users by email. A company can never lose its last admin.

## Escrow settlement

State changes write events to `outbox_events` in the same transaction: `escrow.funding_requested` and `escrow.release_requested`. The `escrow-settlement` Edge Function processes them:

- `POST /escrow-settlement/webhook`: payment rail callback, verified with HMAC-SHA256 in the `x-signature` header (secret `PAYMENT_WEBHOOK_SECRET`).
- `POST /escrow-settlement/drain`: claims outbox events with `SKIP LOCKED`, requests funding or pays out through the `PaymentProvider` interface, and records the result. Requires `Authorization: Bearer $CRON_SECRET`.

The default `ManualTransferProvider` represents bank EFT handled by finance ops. To use a gateway API, implement `PaymentProvider` in `supabase/functions/_shared/payments.ts`.

```bash
supabase secrets set PAYMENT_WEBHOOK_SECRET=... CRON_SECRET=...
supabase functions deploy escrow-settlement
```

Run the drain every minute with `pg_cron` and `pg_net` (both enabled in the Supabase dashboard):

```sql
select cron.schedule('escrow-drain', '* * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/escrow-settlement/drain',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  )
$$);
```

Platform operators are added by hand: `insert into platform_admins (user_id) values ('<auth user id>');`
