-- =============================================================================
-- B2B ZW — 0003 Vertical workflows: atomic listing creation, freight dispatch,
-- auction close, invoicing, escrow, trade finance review, membership, outbox
-- =============================================================================

-- Not exposed through PostgREST (only 'public' is in the API schemas).
CREATE SCHEMA IF NOT EXISTS internal;
GRANT USAGE ON SCHEMA internal TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- PLATFORM OPERATORS + OUTBOX
-- -----------------------------------------------------------------------------
CREATE TABLE platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;  -- no policies: invisible to clients

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

-- Side effects (payouts, notifications) are queued here in the same transaction as the
-- state change, then drained by the escrow-settlement Edge Function with the service role.
CREATE TABLE outbox_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic         TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;  -- service role only
CREATE INDEX outbox_queue_idx ON outbox_events(id) WHERE status IN ('pending', 'failed');

CREATE OR REPLACE FUNCTION internal.emit(p_topic TEXT, p_payload JSONB) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.outbox_events(topic, payload) VALUES (p_topic, p_payload)
$$;
REVOKE EXECUTE ON FUNCTION internal.emit FROM PUBLIC, anon, authenticated;

-- Claims a batch for a worker; SKIP LOCKED lets several workers run safely.
CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_topics TEXT[], p_limit INT DEFAULT 20)
RETURNS SETOF public.outbox_events
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.outbox_events o
     SET status = 'processing', attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.outbox_events
      WHERE status IN ('pending', 'failed') AND attempts < 8 AND topic = ANY(p_topics)
      ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING o.*
$$;

CREATE OR REPLACE FUNCTION public.complete_outbox_event(p_id BIGINT, p_error TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.outbox_events
     SET status = CASE WHEN p_error IS NULL THEN 'done' ELSE 'failed' END,
         last_error = p_error, processed_at = NOW()
   WHERE id = p_id
$$;

-- -----------------------------------------------------------------------------
-- AUCTION RESERVES (sealed from bidders — RLS cannot hide a single column)
-- -----------------------------------------------------------------------------
CREATE TABLE listing_reserves (
  listing_id    UUID PRIMARY KEY REFERENCES b2b_listings(id) ON DELETE CASCADE,
  reserve_price NUMERIC(14,2) NOT NULL CHECK (reserve_price >= 0)
);
ALTER TABLE listing_reserves ENABLE ROW LEVEL SECURITY;
CREATE POLICY reserves_owner ON listing_reserves FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM b2b_listings l WHERE l.id = listing_id AND is_company_member(l.company_id)));
INSERT INTO listing_reserves SELECT id, reserve_price FROM b2b_listings WHERE reserve_price IS NOT NULL;
ALTER TABLE b2b_listings DROP COLUMN reserve_price;

-- Bidders learn only whether the reserve has been met.
CREATE OR REPLACE FUNCTION public.auction_reserve_met(p_listing UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT MAX(b.amount) FROM public.auction_bids b WHERE b.listing_id = p_listing), 0)
         >= COALESCE((SELECT r.reserve_price FROM public.listing_reserves r WHERE r.listing_id = p_listing), 0)
   WHERE EXISTS (SELECT 1 FROM public.b2b_listings l WHERE l.id = p_listing AND l.approval_status = 'approved'
                    OR public.is_company_member(l.company_id))
$$;

-- -----------------------------------------------------------------------------
-- ATOMIC LISTING CREATION (listing + vertical details in one transaction)
-- -----------------------------------------------------------------------------
-- Inserts only the keys present in p_row, so column defaults still apply.
-- SECURITY INVOKER: the caller's RLS policies govern the insert.
CREATE OR REPLACE FUNCTION internal.insert_from_jsonb(p_table REGCLASS, p_row JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE cols TEXT; new_id UUID;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ') INTO cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attgenerated = '' AND a.attidentity = '' AND p_row ? a.attname;
  IF cols IS NULL THEN RAISE EXCEPTION 'No valid columns for %', p_table; END IF;
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_record(NULL::%s, $1) RETURNING id',
                 p_table, cols, cols, p_table)
     INTO new_id USING p_row;
  RETURN new_id;
END $$;
GRANT EXECUTE ON FUNCTION internal.insert_from_jsonb TO authenticated;

CREATE OR REPLACE FUNCTION internal.detail_table(t public.b2b_listing_type) RETURNS REGCLASS
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE t
    WHEN 'freight_haulage'     THEN 'public.freight_dispatches'
    WHEN 'plant_machinery'     THEN 'public.plant_machinery_details'
    WHEN 'fuel_procurement'    THEN 'public.fuel_procurement_details'
    WHEN 'storage_space'       THEN 'public.storage_facility_details'
    WHEN 'sla_service'         THEN 'public.sla_service_details'
    WHEN 'agri_offtake'        THEN 'public.agri_offtake_details'
    WHEN 'commercial_property' THEN 'public.commercial_property_details'
  END::REGCLASS
$$;
GRANT EXECUTE ON FUNCTION internal.detail_table TO authenticated;

CREATE OR REPLACE FUNCTION internal.set_reserve(p_listing UUID, p_reserve NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_edit_listing(p_listing) THEN RAISE EXCEPTION 'Listing not editable' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.listing_reserves(listing_id, reserve_price) VALUES (p_listing, p_reserve)
  ON CONFLICT (listing_id) DO UPDATE SET reserve_price = EXCLUDED.reserve_price;
END $$;
REVOKE EXECUTE ON FUNCTION internal.set_reserve FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.set_reserve TO authenticated;

CREATE OR REPLACE FUNCTION public.create_listing(
  p_company UUID, p_listing JSONB, p_details JSONB DEFAULT NULL, p_submit BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  lid UUID;
  tbl REGCLASS;
  ltype public.b2b_listing_type := (p_listing->>'listing_type')::public.b2b_listing_type;
  result_status public.approval_status_enum := 'draft';
BEGIN
  lid := internal.insert_from_jsonb('public.b2b_listings',
    (p_listing - 'id' - 'status' - 'reserve_price' - 'approval_status' - 'created_at' - 'updated_at')
    || jsonb_build_object('company_id', p_company, 'created_by_user_id', auth.uid(), 'approval_status', 'draft'));

  IF p_listing ? 'reserve_price' THEN
    IF ltype <> 'asset_auction' THEN RAISE EXCEPTION 'Reserve prices apply to auctions only'; END IF;
    -- listing_reserves has no client INSERT policy; set_reserve checks edit rights itself.
    PERFORM internal.set_reserve(lid, (p_listing->>'reserve_price')::NUMERIC);
  END IF;

  tbl := internal.detail_table(ltype);
  IF tbl IS NOT NULL THEN
    IF p_details IS NULL THEN RAISE EXCEPTION '% listings require details', ltype; END IF;
    -- Strip workflow-owned columns; those only change through RPCs.
    PERFORM internal.insert_from_jsonb(tbl,
      (p_details - 'id' - 'carrier_company_id' - 'driver_user_id' - 'dispatch_status'
                 - 'proof_of_delivery_attachment_id' - 'bill_of_lading_attachment_id' - 'delivered_at')
      || jsonb_build_object('listing_id', lid));
  END IF;

  IF p_submit THEN result_status := public.submit_listing_for_approval(lid); END IF;
  RETURN jsonb_build_object('id', lid, 'approval_status', result_status);
END $$;

CREATE OR REPLACE FUNCTION public.get_listing_details(p_listing UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE tbl REGCLASS; out JSONB;
BEGIN
  SELECT internal.detail_table(listing_type) INTO tbl FROM public.b2b_listings WHERE id = p_listing;
  IF tbl IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT to_jsonb(d) FROM %s d WHERE listing_id = $1', tbl) INTO out USING p_listing;
  RETURN out;
END $$;

-- -----------------------------------------------------------------------------
-- AWARD (replaces 0002 version: freight awards assign the carrier)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_proposal(p_proposal UUID, p_reason TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.rfq_proposals%ROWTYPE;
  l public.b2b_listings%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.rfq_proposals WHERE id = p_proposal;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found'; END IF;
  SELECT * INTO l FROM public.b2b_listings WHERE id = p.listing_id FOR UPDATE;

  IF NOT public.has_company_role(l.company_id, ARRAY['procurement_officer','logistics_manager']::public.company_role_enum[]) THEN
    RAISE EXCEPTION 'Only the buyer''s procurement or logistics team can award' USING ERRCODE = '42501';
  END IF;
  IF l.bidding_closes_at > NOW() THEN RAISE EXCEPTION 'Bidding is still open'; END IF;
  IF l.status <> 'open' OR l.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Listing is not awardable (status %)', l.status;
  END IF;
  IF p.status <> 'submitted' THEN RAISE EXCEPTION 'Proposal was withdrawn'; END IF;

  UPDATE public.rfq_proposals
     SET is_winning_bid = (id = p_proposal),
         status = CASE WHEN id = p_proposal THEN 'won' ELSE 'lost' END::public.proposal_status_enum
   WHERE listing_id = l.id AND status = 'submitted';
  UPDATE public.b2b_listings SET status = 'awarded' WHERE id = l.id;

  IF l.listing_type = 'freight_haulage' THEN
    UPDATE public.freight_dispatches
       SET carrier_company_id = p.vendor_company_id, dispatch_status = 'assigned'
     WHERE listing_id = l.id;
  END IF;

  PERFORM public.write_audit(l.company_id, 'rfq.awarded', 'b2b_listings', l.id,
    jsonb_build_object('proposal_id', p_proposal, 'vendor_company_id', p.vendor_company_id,
                       'bid_amount', p.bid_amount, 'currency', p.currency, 'reason', p_reason));
  PERFORM public.write_audit(p.vendor_company_id, 'rfq.won', 'rfq_proposals', p_proposal, '{}');
  PERFORM internal.emit('listing.awarded', jsonb_build_object('listing_id', l.id, 'proposal_id', p_proposal));
END $$;

-- -----------------------------------------------------------------------------
-- AUCTION CLOSE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_auction(p_listing UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.b2b_listings%ROWTYPE;
  top public.auction_bids%ROWTYPE;
  reserve NUMERIC;
  met BOOLEAN;
BEGIN
  SELECT * INTO l FROM public.b2b_listings WHERE id = p_listing FOR UPDATE;
  IF NOT FOUND OR l.listing_type <> 'asset_auction' THEN RAISE EXCEPTION 'Not an auction'; END IF;
  IF NOT public.has_company_role(l.company_id, ARRAY['procurement_officer']::public.company_role_enum[]) THEN
    RAISE EXCEPTION 'Only the seller can close the auction' USING ERRCODE = '42501';
  END IF;
  IF l.status <> 'open' THEN RAISE EXCEPTION 'Auction already %', l.status; END IF;
  IF l.bidding_closes_at > NOW() THEN RAISE EXCEPTION 'Auction is still running'; END IF;

  SELECT * INTO top FROM public.auction_bids WHERE listing_id = p_listing ORDER BY amount DESC, created_at LIMIT 1;
  SELECT reserve_price INTO reserve FROM public.listing_reserves WHERE listing_id = p_listing;
  met := top.id IS NOT NULL AND top.amount >= COALESCE(reserve, 0);

  UPDATE public.b2b_listings SET status = CASE WHEN met THEN 'awarded' ELSE 'closed' END::public.listing_status_enum
   WHERE id = p_listing;
  PERFORM public.write_audit(l.company_id, CASE WHEN met THEN 'auction.sold' ELSE 'auction.reserve_not_met' END,
    'b2b_listings', p_listing,
    jsonb_build_object('winning_bid_id', top.id, 'amount', top.amount, 'reserve', reserve));
  IF met THEN
    PERFORM internal.emit('listing.awarded', jsonb_build_object('listing_id', p_listing, 'auction_bid_id', top.id));
  END IF;
  RETURN jsonb_build_object('sold', met, 'winning_company_id', CASE WHEN met THEN top.bidder_company_id END,
                            'amount', top.amount);
END $$;

-- -----------------------------------------------------------------------------
-- FREIGHT DISPATCH LIFECYCLE: posted → assigned → loaded → in_transit → delivered
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_dispatch(
  p_listing UUID, p_status public.freight_status_enum DEFAULT NULL, p_driver UUID DEFAULT NULL
) RETURNS public.freight_status_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.freight_dispatches%ROWTYPE;
  buyer UUID;
  is_carrier BOOLEAN;
  is_driver BOOLEAN;
BEGIN
  SELECT * INTO f FROM public.freight_dispatches WHERE listing_id = p_listing FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispatch not found'; END IF;
  SELECT company_id INTO buyer FROM public.b2b_listings WHERE id = p_listing;
  is_carrier := f.carrier_company_id IS NOT NULL
    AND public.has_company_role(f.carrier_company_id, ARRAY['logistics_manager']::public.company_role_enum[]);
  is_driver := f.driver_user_id = auth.uid();

  IF p_driver IS NOT NULL THEN
    IF NOT is_carrier THEN RAISE EXCEPTION 'Only the carrier can assign drivers' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.company_users
                    WHERE company_id = f.carrier_company_id AND user_id = p_driver AND role = 'driver') THEN
      RAISE EXCEPTION 'Driver must be a driver in the carrier company';
    END IF;
    UPDATE public.freight_dispatches SET driver_user_id = p_driver WHERE id = f.id;
  END IF;

  IF p_status IS NOT NULL THEN
    IF p_status = 'cancelled' THEN
      IF NOT public.has_company_role(buyer, ARRAY['logistics_manager']::public.company_role_enum[]) THEN
        RAISE EXCEPTION 'Only the shipper can cancel' USING ERRCODE = '42501';
      END IF;
      IF f.dispatch_status NOT IN ('posted', 'assigned') THEN
        RAISE EXCEPTION 'Cannot cancel once loaded';
      END IF;
    ELSIF p_status = 'delivered' THEN
      RAISE EXCEPTION 'Use confirm_delivery with a proof-of-delivery document';
    ELSE
      IF NOT (is_carrier OR is_driver) THEN RAISE EXCEPTION 'Not assigned to this dispatch' USING ERRCODE = '42501'; END IF;
      IF NOT ((f.dispatch_status = 'assigned' AND p_status = 'loaded')
           OR (f.dispatch_status = 'loaded'   AND p_status = 'in_transit')) THEN
        RAISE EXCEPTION 'Invalid transition % → %', f.dispatch_status, p_status;
      END IF;
    END IF;
    UPDATE public.freight_dispatches SET dispatch_status = p_status WHERE id = f.id;
    PERFORM public.write_audit(buyer, 'freight.' || p_status, 'freight_dispatches', f.id,
                               jsonb_build_object('from', f.dispatch_status));
  END IF;
  RETURN COALESCE(p_status, f.dispatch_status);
END $$;

-- Replaces 0002 version: validates the PoD document and queues escrow release.
CREATE OR REPLACE FUNCTION public.confirm_delivery(p_listing UUID, p_pod_attachment UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.freight_dispatches%ROWTYPE; buyer UUID;
BEGIN
  SELECT * INTO f FROM public.freight_dispatches WHERE listing_id = p_listing FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispatch not found'; END IF;
  IF NOT (f.driver_user_id = auth.uid()
          OR public.has_company_role(f.carrier_company_id, ARRAY['logistics_manager']::public.company_role_enum[])) THEN
    RAISE EXCEPTION 'Not assigned to this dispatch' USING ERRCODE = '42501';
  END IF;
  IF f.dispatch_status NOT IN ('loaded', 'in_transit') THEN
    RAISE EXCEPTION 'Cannot deliver from status %', f.dispatch_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.attachments
                  WHERE id = p_pod_attachment AND company_id = f.carrier_company_id) THEN
    RAISE EXCEPTION 'Proof of delivery must be uploaded by the carrier';
  END IF;
  -- Make the PoD visible to the shipper.
  UPDATE public.attachments SET listing_id = p_listing WHERE id = p_pod_attachment;
  UPDATE public.freight_dispatches
     SET dispatch_status = 'delivered', proof_of_delivery_attachment_id = p_pod_attachment, delivered_at = NOW()
   WHERE id = f.id;
  SELECT company_id INTO buyer FROM public.b2b_listings WHERE id = p_listing;
  PERFORM public.write_audit(buyer, 'freight.delivered', 'freight_dispatches', f.id,
                             jsonb_build_object('pod_attachment_id', p_pod_attachment));
  PERFORM internal.emit('escrow.release_requested', jsonb_build_object('listing_id', p_listing, 'reason', 'epod_confirmed'));
END $$;

-- -----------------------------------------------------------------------------
-- INVOICING + ESCROW
-- -----------------------------------------------------------------------------
ALTER TABLE escrow_transactions ADD COLUMN provider_reference TEXT;
ALTER TABLE escrow_transactions ADD COLUMN listing_id UUID REFERENCES b2b_listings(id) ON DELETE SET NULL;
CREATE INDEX ON escrow_transactions(listing_id);
CREATE INDEX ON invoices(listing_id);

-- Vendor finance raises a tax invoice for a won proposal. Escrow terms open an escrow.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_proposal UUID, p_invoice_number TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.rfq_proposals%ROWTYPE;
  l public.b2b_listings%ROWTYPE;
  inv UUID;
  due DATE;
BEGIN
  SELECT * INTO p FROM public.rfq_proposals WHERE id = p_proposal;
  IF NOT FOUND OR p.status <> 'won' THEN RAISE EXCEPTION 'Only won proposals can be invoiced'; END IF;
  IF NOT public.has_company_role(p.vendor_company_id, ARRAY['finance_approver']::public.company_role_enum[]) THEN
    RAISE EXCEPTION 'Requires finance_approver at the vendor' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE proposal_id = p_proposal AND status <> 'void') THEN
    RAISE EXCEPTION 'Proposal already invoiced';
  END IF;
  SELECT * INTO l FROM public.b2b_listings WHERE id = p.listing_id;
  due := CURRENT_DATE + CASE l.payment_terms
    WHEN 'net_15' THEN 15 WHEN 'net_30' THEN 30 WHEN 'net_60' THEN 60 ELSE 0 END;

  INSERT INTO public.invoices(invoice_number, issuer_company_id, payer_company_id, listing_id, proposal_id,
                              subtotal, currency, payment_terms, status, issued_at, due_date)
  VALUES (p_invoice_number, p.vendor_company_id, l.company_id, l.id, p.id,
          p.bid_amount, p.currency, l.payment_terms, 'issued', NOW(), due)
  RETURNING id INTO inv;

  IF l.payment_terms = 'escrow' THEN
    INSERT INTO public.escrow_transactions(invoice_id, listing_id, payer_company_id, payee_company_id, amount, currency,
                                           release_condition)
    SELECT inv, l.id, l.company_id, p.vendor_company_id, i.total, p.currency,
           CASE WHEN l.listing_type = 'freight_haulage' THEN 'epod_confirmed' ELSE 'buyer_acceptance' END
      FROM public.invoices i WHERE i.id = inv;
    PERFORM internal.emit('escrow.funding_requested', jsonb_build_object('invoice_id', inv));
  END IF;
  RETURN inv;
END $$;

-- Buyer accepts goods/services → release (non-freight escrows).
CREATE OR REPLACE FUNCTION public.accept_delivery(p_listing UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE buyer UUID;
BEGIN
  SELECT company_id INTO buyer FROM public.b2b_listings WHERE id = p_listing;
  IF NOT public.has_company_role(buyer, ARRAY['procurement_officer','finance_approver']::public.company_role_enum[]) THEN
    RAISE EXCEPTION 'Only the buyer can accept delivery' USING ERRCODE = '42501';
  END IF;
  PERFORM public.write_audit(buyer, 'delivery.accepted', 'b2b_listings', p_listing, '{}');
  PERFORM internal.emit('escrow.release_requested', jsonb_build_object('listing_id', p_listing, 'reason', 'buyer_acceptance'));
END $$;

-- Escrow state machine. Service role only (payment webhooks / settlement worker).
CREATE OR REPLACE FUNCTION public.escrow_transition(
  p_escrow UUID, p_to public.escrow_status_enum, p_reference TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.escrow_transactions%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.escrow_transactions WHERE id = p_escrow FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escrow not found'; END IF;
  IF e.status = p_to THEN RETURN; END IF;  -- idempotent for webhook retries
  IF NOT ((e.status = 'pending_funding' AND p_to IN ('funded', 'refunded'))
       OR (e.status = 'funded'          AND p_to IN ('released', 'refunded', 'disputed'))
       OR (e.status = 'disputed'        AND p_to IN ('released', 'refunded'))) THEN
    RAISE EXCEPTION 'Invalid escrow transition % → %', e.status, p_to;
  END IF;
  UPDATE public.escrow_transactions
     SET status = p_to, provider_reference = COALESCE(p_reference, provider_reference)
   WHERE id = p_escrow;
  IF p_to = 'released' THEN
    UPDATE public.invoices SET status = 'paid' WHERE id = e.invoice_id;
  END IF;
  INSERT INTO public.system_audit_logs(company_id, action_type, entity_table, entity_id, details)
  VALUES (e.payer_company_id, 'escrow.' || p_to, 'escrow_transactions', e.id,
          jsonb_build_object('from', e.status, 'reference', p_reference, 'amount', e.amount)),
         (e.payee_company_id, 'escrow.' || p_to, 'escrow_transactions', e.id,
          jsonb_build_object('from', e.status, 'reference', p_reference, 'amount', e.amount));
END $$;

-- -----------------------------------------------------------------------------
-- TRADE FINANCE REVIEW (platform operators)
-- -----------------------------------------------------------------------------
ALTER TABLE trade_finance_requests ADD COLUMN reviewer_note TEXT;
ALTER TABLE trade_finance_requests ADD COLUMN approved_advance NUMERIC(14,2);
ALTER TABLE trade_finance_requests ADD COLUMN discount_rate_pct NUMERIC(5,2);

CREATE POLICY tf_platform_select ON trade_finance_requests FOR SELECT TO authenticated
  USING (is_platform_admin());

CREATE OR REPLACE FUNCTION public.review_trade_finance(
  p_request UUID, p_status public.finance_status_enum, p_note TEXT DEFAULT NULL,
  p_discount_rate_pct NUMERIC DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.trade_finance_requests%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform operators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.trade_finance_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT ((r.status = 'under_review' AND p_status IN ('approved', 'rejected'))
       OR (r.status = 'approved'     AND p_status IN ('funded', 'rejected'))
       OR (r.status = 'funded'       AND p_status = 'settled')) THEN
    RAISE EXCEPTION 'Invalid transition % → %', r.status, p_status;
  END IF;
  IF p_status = 'approved' AND p_discount_rate_pct IS NULL THEN
    RAISE EXCEPTION 'Approval requires a discount rate';
  END IF;
  UPDATE public.trade_finance_requests
     SET status = p_status,
         reviewer_note = COALESCE(p_note, reviewer_note),
         discount_rate_pct = COALESCE(p_discount_rate_pct, discount_rate_pct),
         approved_advance = CASE WHEN p_status = 'approved'
           THEN ROUND(invoice_amount * advance_requested_percentage / 100, 2) ELSE approved_advance END
   WHERE id = p_request;
  PERFORM public.write_audit(r.company_id, 'trade_finance.' || p_status, 'trade_finance_requests', r.id,
                             jsonb_build_object('note', p_note, 'discount_rate_pct', p_discount_rate_pct));
  IF p_status = 'funded' THEN
    PERFORM internal.emit('trade_finance.funded', jsonb_build_object('request_id', r.id));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- MEMBERSHIP
-- -----------------------------------------------------------------------------
-- The invitee must already have signed up; admins add them by email.
CREATE OR REPLACE FUNCTION public.add_company_member(
  p_company UUID, p_email TEXT, p_role public.company_role_enum, p_branch UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid UUID; mid UUID;
BEGIN
  IF NOT public.has_company_role(p_company, ARRAY[]::public.company_role_enum[]) THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF uid IS NULL THEN RAISE EXCEPTION 'No account for %. Ask them to sign up first.', p_email; END IF;
  INSERT INTO public.company_users(company_id, branch_id, user_id, role)
  VALUES (p_company, p_branch, uid, p_role)
  ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role, branch_id = EXCLUDED.branch_id
  RETURNING id INTO mid;
  RETURN mid;
END $$;

-- Members list with emails (company_users alone has only user ids).
CREATE OR REPLACE FUNCTION public.list_company_members(p_company UUID)
RETURNS TABLE (member_id UUID, user_id UUID, email TEXT, role public.company_role_enum, branch_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT cu.id, cu.user_id, u.email::TEXT, cu.role, cu.branch_id
    FROM public.company_users cu JOIN auth.users u ON u.id = cu.user_id
   WHERE cu.company_id = p_company AND public.is_company_member(p_company)
   ORDER BY cu.created_at
$$;

-- Never leave a company without an admin.
CREATE OR REPLACE FUNCTION internal.keep_one_admin() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.role = 'admin' AND (TG_OP = 'DELETE' OR NEW.role <> 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.company_users
                      WHERE company_id = OLD.company_id AND role = 'admin' AND id <> OLD.id)
     AND EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RAISE EXCEPTION 'A company must keep at least one admin';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER keep_one_admin BEFORE UPDATE OF role OR DELETE ON company_users
  FOR EACH ROW EXECUTE FUNCTION internal.keep_one_admin();

-- -----------------------------------------------------------------------------
-- GRANTS
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.auction_reserve_met FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_reserve_met TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_listing, public.get_listing_details, public.close_auction,
  public.update_dispatch, public.issue_invoice, public.accept_delivery, public.review_trade_finance,
  public.add_company_member, public.list_company_members, public.is_platform_admin,
  public.escrow_transition, public.claim_outbox_events, public.complete_outbox_event FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_listing, public.get_listing_details, public.close_auction,
  public.update_dispatch, public.issue_invoice, public.accept_delivery, public.review_trade_finance,
  public.add_company_member, public.list_company_members, public.is_platform_admin TO authenticated;
REVOKE EXECUTE ON FUNCTION public.escrow_transition, public.claim_outbox_events, public.complete_outbox_event
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.escrow_transition, public.claim_outbox_events, public.complete_outbox_event
  TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE escrow_transactions, trade_finance_requests;
