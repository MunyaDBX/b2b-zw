-- =============================================================================
-- B2B ZW — 0001 Core schema: enums, tenancy, listings, vertical details
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
CREATE TYPE b2b_listing_type AS ENUM (
  'rfq_procurement', 'asset_auction', 'commercial_property',
  'freight_haulage', 'sla_service', 'plant_machinery',
  'agri_offtake', 'fuel_procurement', 'storage_space'
);
CREATE TYPE approval_status_enum   AS ENUM ('draft', 'pending_approval', 'approved', 'rejected');
CREATE TYPE listing_status_enum    AS ENUM ('open', 'closed', 'awarded', 'cancelled', 'expired');
CREATE TYPE payment_terms_enum     AS ENUM ('immediate', 'net_15', 'net_30', 'net_60', 'escrow');
CREATE TYPE plant_rate_type_enum   AS ENUM ('hourly', 'daily', 'monthly', 'wet_rate', 'dry_rate');
CREATE TYPE fuel_type_enum         AS ENUM ('diesel_50ppm', 'petrol_unleaded', 'heavy_fuel_oil', 'lpg_gas');
CREATE TYPE company_type_enum      AS ENUM ('buyer', 'supplier', 'logistics_provider', 'hybrid');
CREATE TYPE company_role_enum      AS ENUM ('admin', 'procurement_officer', 'finance_approver', 'logistics_manager', 'driver');
CREATE TYPE cargo_type_enum        AS ENUM ('palletized', 'bulk_grain', 'fuel_tanker', 'heavy_machinery', 'containerized', 'general');
CREATE TYPE truck_type_enum        AS ENUM ('3ton_rigid', '7ton_flatbed', '15ton_rigid', '30ton_curtain_side', '30ton_flatbed', 'refrigerated', 'tanker', 'lowbed');
CREATE TYPE freight_status_enum    AS ENUM ('posted', 'assigned', 'loaded', 'in_transit', 'delivered', 'cancelled');
CREATE TYPE fuel_delivery_enum     AS ENUM ('depot_pickup', 'onsite_bowser_drop');
CREATE TYPE storage_type_enum      AS ENUM ('bonded_warehouse', 'open_yard', 'cold_storage', 'pallet_racking', 'office');
CREATE TYPE proposal_status_enum   AS ENUM ('submitted', 'withdrawn', 'won', 'lost');
CREATE TYPE finance_status_enum    AS ENUM ('under_review', 'approved', 'funded', 'settled', 'rejected');
CREATE TYPE escrow_status_enum     AS ENUM ('pending_funding', 'funded', 'released', 'refunded', 'disputed');
CREATE TYPE invoice_status_enum    AS ENUM ('draft', 'issued', 'paid', 'overdue', 'void');
CREATE TYPE sla_priority_enum      AS ENUM ('p1_critical', 'p2_high', 'p3_normal', 'p4_low');
CREATE TYPE approval_entity_enum   AS ENUM ('listing', 'purchase_order', 'trade_finance', 'award');
CREATE TYPE approval_step_status   AS ENUM ('pending', 'approved', 'rejected', 'skipped');

-- -----------------------------------------------------------------------------
-- TENANCY
-- -----------------------------------------------------------------------------
CREATE TABLE companies (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name         TEXT NOT NULL,
  registration_number  TEXT UNIQUE NOT NULL,
  vat_tax_id           TEXT,
  company_type         company_type_enum NOT NULL,
  credit_limit         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  -- Listings with a budget above this need finance_approver sign-off.
  finance_approval_threshold NUMERIC(14,2) NOT NULL DEFAULT 5000,
  is_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_business_number VARCHAR(16) CHECK (whatsapp_business_number ~ '^\+[1-9][0-9]{7,14}$'),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE company_branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  city        TEXT,
  address     TEXT,
  is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON company_branches(company_id);
CREATE UNIQUE INDEX one_head_office_per_company ON company_branches(company_id) WHERE is_head_office;

CREATE TABLE company_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES company_branches(id) ON DELETE SET NULL,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        company_role_enum NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX ON company_users(user_id);

-- -----------------------------------------------------------------------------
-- MASTER LISTINGS
-- -----------------------------------------------------------------------------
CREATE TABLE b2b_listings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id              UUID REFERENCES company_branches(id) ON DELETE SET NULL,
  created_by_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title                  TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description            TEXT,
  category               TEXT NOT NULL,
  listing_type           b2b_listing_type NOT NULL,
  approval_status        approval_status_enum NOT NULL DEFAULT 'draft',
  status                 listing_status_enum  NOT NULL DEFAULT 'open',
  budget_or_target_price NUMERIC(14,2) CHECK (budget_or_target_price >= 0),
  reserve_price          NUMERIC(14,2) CHECK (reserve_price >= 0),      -- asset auctions
  currency               CHAR(3) NOT NULL DEFAULT 'USD',
  payment_terms          payment_terms_enum NOT NULL DEFAULT 'immediate',
  delivery_location      TEXT,
  whatsapp_business_number VARCHAR(16) CHECK (whatsapp_business_number ~ '^\+[1-9][0-9]{7,14}$'),
  -- Sealed bids are revealed to the buyer only once this passes.
  bidding_closes_at      TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bidding_required_for_competitive CHECK (
    listing_type NOT IN ('rfq_procurement', 'asset_auction', 'fuel_procurement') OR bidding_closes_at IS NOT NULL
  ),
  CONSTRAINT reserve_only_for_auctions CHECK (reserve_price IS NULL OR listing_type = 'asset_auction')
);
CREATE INDEX listings_feed_idx ON b2b_listings(listing_type, approval_status, status, created_at DESC);
CREATE INDEX ON b2b_listings(company_id, created_at DESC);
CREATE INDEX ON b2b_listings(created_by_user_id);

-- Replaces images_and_docs TEXT[]: one row per Storage object so RLS can apply per file.
CREATE TABLE attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  listing_id    UUID REFERENCES b2b_listings(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL UNIQUE,  -- '<company_id>/<uuid>.<ext>' in bucket 'b2b-docs'
  mime_type     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  size_bytes    BIGINT CHECK (size_bytes > 0),
  uploaded_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON attachments(listing_id);
CREATE INDEX ON attachments(company_id);

-- -----------------------------------------------------------------------------
-- BIDDING
-- -----------------------------------------------------------------------------
-- Sealed RFQ proposals (rfq_procurement, fuel_procurement, freight_haulage, sla_service).
CREATE TABLE rfq_proposals (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id              UUID NOT NULL REFERENCES b2b_listings(id) ON DELETE CASCADE,
  vendor_company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  submitted_by_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  bid_amount              NUMERIC(14,2) NOT NULL CHECK (bid_amount > 0),
  currency                CHAR(3) NOT NULL DEFAULT 'USD',
  delivery_timeline_days  INT NOT NULL CHECK (delivery_timeline_days > 0),
  notes                   TEXT,
  proposal_attachment_id  UUID REFERENCES attachments(id) ON DELETE SET NULL,
  status                  proposal_status_enum NOT NULL DEFAULT 'submitted',
  is_winning_bid          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, vendor_company_id)
);
CREATE UNIQUE INDEX one_winner_per_listing ON rfq_proposals(listing_id) WHERE is_winning_bid;
CREATE INDEX ON rfq_proposals(vendor_company_id);

-- Open ascending auction bids (asset_auction). Visible to all participants.
CREATE TABLE auction_bids (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         UUID NOT NULL REFERENCES b2b_listings(id) ON DELETE CASCADE,
  bidder_company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bidder_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON auction_bids(listing_id, amount DESC);

-- -----------------------------------------------------------------------------
-- VERTICAL DETAIL TABLES (1:1 with b2b_listings)
-- -----------------------------------------------------------------------------
CREATE TABLE freight_dispatches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            UUID NOT NULL UNIQUE REFERENCES b2b_listings(id) ON DELETE CASCADE,
  origin_address        TEXT NOT NULL,
  destination_address   TEXT NOT NULL,
  cargo_type            cargo_type_enum NOT NULL,
  required_truck_type   truck_type_enum NOT NULL,
  cargo_weight_tonnes   NUMERIC(8,2) NOT NULL CHECK (cargo_weight_tonnes BETWEEN 0.1 AND 60),
  pickup_window_start   TIMESTAMPTZ,
  pickup_window_end     TIMESTAMPTZ,
  carrier_company_id    UUID REFERENCES companies(id) ON DELETE SET NULL,
  driver_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispatch_status       freight_status_enum NOT NULL DEFAULT 'posted',
  bill_of_lading_attachment_id   UUID REFERENCES attachments(id) ON DELETE SET NULL,
  proof_of_delivery_attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
  delivered_at          TIMESTAMPTZ,
  CHECK (pickup_window_end IS NULL OR pickup_window_end > pickup_window_start)
);
CREATE INDEX ON freight_dispatches(driver_user_id);
CREATE INDEX ON freight_dispatches(carrier_company_id);

CREATE TABLE plant_machinery_details (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id               UUID NOT NULL UNIQUE REFERENCES b2b_listings(id) ON DELETE CASCADE,
  equipment_type           TEXT NOT NULL,
  make_model               TEXT NOT NULL,
  year_of_manufacture      INT CHECK (year_of_manufacture BETWEEN 1950 AND 2100),
  capacity_rating          TEXT NOT NULL,
  rate_type                plant_rate_type_enum NOT NULL DEFAULT 'daily',
  rate_amount              NUMERIC(14,2) NOT NULL CHECK (rate_amount > 0),
  includes_operator        BOOLEAN NOT NULL DEFAULT TRUE,
  mobilization_fee         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (mobilization_fee >= 0),
  last_safety_inspection   DATE,
  operator_certificate_attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL
);

CREATE TABLE fuel_procurement_details (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id                  UUID NOT NULL UNIQUE REFERENCES b2b_listings(id) ON DELETE CASCADE,
  fuel_type                   fuel_type_enum NOT NULL,
  quantity_liters             NUMERIC(12,2) NOT NULL CHECK (quantity_liters BETWEEN 500 AND 1000000),
  delivery_type               fuel_delivery_enum NOT NULL,
  target_price_per_liter      NUMERIC(8,4) NOT NULL CHECK (target_price_per_liter > 0),
  requires_metered_discharge  BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (delivery_type <> 'onsite_bowser_drop' OR quantity_liters BETWEEN 5000 AND 40000)
);

CREATE TABLE storage_facility_details (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id              UUID NOT NULL UNIQUE REFERENCES b2b_listings(id) ON DELETE CASCADE,
  storage_type            storage_type_enum NOT NULL,
  total_area_sqm          NUMERIC(10,2) CHECK (total_area_sqm > 0),
  available_pallet_spaces INT CHECK (available_pallet_spaces >= 0),
  dock_doors              INT CHECK (dock_doors >= 0),
  security_features       TEXT[] NOT NULL DEFAULT '{}',
  rate_per_sqm_or_pallet  NUMERIC(12,2) NOT NULL CHECK (rate_per_sqm_or_pallet > 0),
  minimum_lease_days      INT NOT NULL DEFAULT 30 CHECK (minimum_lease_days > 0)
);

CREATE TABLE sla_service_details (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            UUID NOT NULL UNIQUE REFERENCES b2b_listings(id) ON DELETE CASCADE,
  trade                 TEXT NOT NULL,              -- 'solar', 'hvac', 'electrical', 'plumbing'
  priority              sla_priority_enum NOT NULL DEFAULT 'p3_normal',
  response_time_hours   INT NOT NULL CHECK (response_time_hours > 0),
  resolution_time_hours INT NOT NULL CHECK (resolution_time_hours > 0),
  penalty_per_breach    NUMERIC(12,2) NOT NULL DEFAULT 0,
  contract_months       INT CHECK (contract_months > 0)
);

CREATE TABLE agri_offtake_details (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id           UUID NOT NULL UNIQUE REFERENCES b2b_listings(id) ON DELETE CASCADE,
  commodity            TEXT NOT NULL,               -- 'maize', 'soya', 'wheat', 'tobacco'
  grade                TEXT,
  quantity_tonnes      NUMERIC(10,2) NOT NULL CHECK (quantity_tonnes > 0),
  price_per_tonne      NUMERIC(12,2) NOT NULL CHECK (price_per_tonne > 0),
  harvest_season       TEXT NOT NULL,               -- e.g. '2026/27'
  delivery_window_start DATE,
  delivery_window_end  DATE,
  requires_cold_chain  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE commercial_property_details (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL UNIQUE REFERENCES b2b_listings(id) ON DELETE CASCADE,
  property_use      TEXT NOT NULL,                  -- 'office', 'industrial', 'executive_stay'
  area_sqm          NUMERIC(10,2) CHECK (area_sqm > 0),
  monthly_rent      NUMERIC(14,2) NOT NULL CHECK (monthly_rent > 0),
  min_lease_months  INT NOT NULL DEFAULT 12,
  furnished         BOOLEAN NOT NULL DEFAULT FALSE
);

-- Enforce listing_type ↔ detail table match.
CREATE OR REPLACE FUNCTION enforce_detail_listing_type() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  actual b2b_listing_type;
BEGIN
  SELECT listing_type INTO actual FROM b2b_listings WHERE id = NEW.listing_id;
  IF actual IS DISTINCT FROM TG_ARGV[0]::b2b_listing_type THEN
    RAISE EXCEPTION '% rows require a % listing (got %)', TG_TABLE_NAME, TG_ARGV[0], actual
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER chk_type BEFORE INSERT OR UPDATE OF listing_id ON freight_dispatches
  FOR EACH ROW EXECUTE FUNCTION enforce_detail_listing_type('freight_haulage');
CREATE TRIGGER chk_type BEFORE INSERT OR UPDATE OF listing_id ON plant_machinery_details
  FOR EACH ROW EXECUTE FUNCTION enforce_detail_listing_type('plant_machinery');
CREATE TRIGGER chk_type BEFORE INSERT OR UPDATE OF listing_id ON fuel_procurement_details
  FOR EACH ROW EXECUTE FUNCTION enforce_detail_listing_type('fuel_procurement');
CREATE TRIGGER chk_type BEFORE INSERT OR UPDATE OF listing_id ON storage_facility_details
  FOR EACH ROW EXECUTE FUNCTION enforce_detail_listing_type('storage_space');
CREATE TRIGGER chk_type BEFORE INSERT OR UPDATE OF listing_id ON sla_service_details
  FOR EACH ROW EXECUTE FUNCTION enforce_detail_listing_type('sla_service');
CREATE TRIGGER chk_type BEFORE INSERT OR UPDATE OF listing_id ON agri_offtake_details
  FOR EACH ROW EXECUTE FUNCTION enforce_detail_listing_type('agri_offtake');
CREATE TRIGGER chk_type BEFORE INSERT OR UPDATE OF listing_id ON commercial_property_details
  FOR EACH ROW EXECUTE FUNCTION enforce_detail_listing_type('commercial_property');

-- -----------------------------------------------------------------------------
-- FINANCE
-- -----------------------------------------------------------------------------
CREATE TABLE trade_finance_requests (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by_user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  purchase_order_ref            TEXT NOT NULL,
  debtor_company_id             UUID REFERENCES companies(id) ON DELETE SET NULL,
  debtor_company_name           TEXT NOT NULL,
  invoice_amount                NUMERIC(14,2) NOT NULL CHECK (invoice_amount > 0),
  currency                      CHAR(3) NOT NULL DEFAULT 'USD',
  advance_requested_percentage  NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (advance_requested_percentage BETWEEN 1 AND 95),
  due_date                      DATE NOT NULL,
  invoice_attachment_id         UUID NOT NULL REFERENCES attachments(id),
  status                        finance_status_enum NOT NULL DEFAULT 'under_review',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON trade_finance_requests(company_id, status);

CREATE TABLE invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number     TEXT NOT NULL,
  issuer_company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payer_company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  listing_id         UUID REFERENCES b2b_listings(id) ON DELETE SET NULL,
  proposal_id        UUID REFERENCES rfq_proposals(id) ON DELETE SET NULL,
  subtotal           NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  vat_rate           NUMERIC(5,2) NOT NULL DEFAULT 15.00,  -- ZIMRA standard rate
  vat_amount         NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(subtotal * vat_rate / 100, 2)) STORED,
  total              NUMERIC(14,2) GENERATED ALWAYS AS (subtotal + ROUND(subtotal * vat_rate / 100, 2)) STORED,
  currency           CHAR(3) NOT NULL DEFAULT 'USD',
  payment_terms      payment_terms_enum NOT NULL,
  status             invoice_status_enum NOT NULL DEFAULT 'draft',
  issued_at          TIMESTAMPTZ,
  due_date           DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issuer_company_id, invoice_number)
);
CREATE INDEX ON invoices(payer_company_id, status);

CREATE TABLE escrow_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  payer_company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payee_company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency           CHAR(3) NOT NULL DEFAULT 'USD',
  status             escrow_status_enum NOT NULL DEFAULT 'pending_funding',
  release_condition  TEXT NOT NULL DEFAULT 'epod_confirmed',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON escrow_transactions(payer_company_id);
CREATE INDEX ON escrow_transactions(payee_company_id);

-- -----------------------------------------------------------------------------
-- CORPORATE COMMUTE
-- -----------------------------------------------------------------------------
CREATE TABLE commute_routes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  route_name       TEXT NOT NULL,
  stops            JSONB NOT NULL DEFAULT '[]',   -- [{name, lat, lng, eta_offset_min}]
  departure_times  TIME[] NOT NULL DEFAULT '{}',
  seats            INT NOT NULL CHECK (seats > 0),
  operator_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON commute_routes(company_id);

-- -----------------------------------------------------------------------------
-- APPROVALS
-- -----------------------------------------------------------------------------
CREATE TABLE approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type     approval_entity_enum NOT NULL,
  entity_id       UUID NOT NULL,
  step_order      SMALLINT NOT NULL CHECK (step_order > 0),
  required_role   company_role_enum NOT NULL,
  status          approval_step_status NOT NULL DEFAULT 'pending',
  requested_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note   TEXT,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, step_order)
);
CREATE INDEX approval_inbox_idx ON approval_requests(company_id, required_role, status);

-- -----------------------------------------------------------------------------
-- AUDIT (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE system_audit_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type  TEXT NOT NULL,
  entity_table TEXT,
  entity_id    UUID,
  details      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON system_audit_logs(company_id, created_at DESC);
CREATE INDEX ON system_audit_logs(entity_table, entity_id);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;
CREATE TRIGGER touch BEFORE UPDATE ON b2b_listings        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON rfq_proposals       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON escrow_transactions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
