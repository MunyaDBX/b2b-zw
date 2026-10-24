-- =============================================================================
-- B2B ZW — 0002 Row Level Security, approval workflow, sealed bidding, audit
-- =============================================================================
-- Principles:
--   * Every table has RLS on. Anything not granted by a policy is denied.
--   * State transitions that need cross-row checks (approve, award, deliver)
--     go through SECURITY DEFINER RPCs, never direct UPDATEs.
--   * Helpers are SECURITY DEFINER with an empty search_path so policies on
--     company_users don't recurse and can't be hijacked.

-- -----------------------------------------------------------------------------
-- HELPERS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_company_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT company_id FROM public.company_users WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(cid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_users WHERE company_id = cid AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(cid UUID, roles public.company_role_enum[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE company_id = cid AND user_id = auth.uid()
      AND (role = ANY(roles) OR role = 'admin')
  )
$$;

-- Can the caller edit this listing's content (only while draft/rejected)?
CREATE OR REPLACE FUNCTION public.can_edit_listing(lid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.b2b_listings l
    WHERE l.id = lid
      AND l.approval_status IN ('draft', 'rejected')
      AND public.has_company_role(l.company_id, ARRAY['procurement_officer','logistics_manager']::public.company_role_enum[])
  )
$$;

CREATE OR REPLACE FUNCTION public.write_audit(
  p_company UUID, p_action TEXT, p_table TEXT, p_entity UUID, p_details JSONB DEFAULT '{}'
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.system_audit_logs(company_id, user_id, action_type, entity_table, entity_id, details)
  VALUES (p_company, auth.uid(), p_action, p_table, p_entity, p_details)
$$;
REVOKE EXECUTE ON FUNCTION public.write_audit FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- ENABLE RLS EVERYWHERE
-- -----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','company_branches','company_users','b2b_listings','attachments',
    'rfq_proposals','auction_bids','freight_dispatches','plant_machinery_details',
    'fuel_procurement_details','storage_facility_details','sla_service_details',
    'agri_offtake_details','commercial_property_details','trade_finance_requests',
    'invoices','escrow_transactions','commute_routes','approval_requests','system_audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- TENANCY POLICIES
-- -----------------------------------------------------------------------------
-- Company directory is visible to all signed-in users (needed to vet counterparties).
CREATE POLICY companies_select ON companies FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY companies_update ON companies FOR UPDATE TO authenticated
  USING (has_company_role(id, ARRAY[]::company_role_enum[]))
  WITH CHECK (has_company_role(id, ARRAY[]::company_role_enum[]));
-- is_verified / credit_limit / threshold are platform-controlled. A column-level REVOKE
-- does not override Supabase's table-level grant, so re-grant only the editable columns.
REVOKE UPDATE ON companies FROM authenticated;
GRANT UPDATE (company_name, vat_tax_id, whatsapp_business_number) ON companies TO authenticated;

CREATE POLICY branches_select ON company_branches FOR SELECT TO authenticated
  USING (is_company_member(company_id));
CREATE POLICY branches_write ON company_branches FOR ALL TO authenticated
  USING (has_company_role(company_id, ARRAY[]::company_role_enum[]))
  WITH CHECK (has_company_role(company_id, ARRAY[]::company_role_enum[]));

CREATE POLICY members_select ON company_users FOR SELECT TO authenticated
  USING (company_id IN (SELECT auth_company_ids()));
CREATE POLICY members_admin_write ON company_users FOR ALL TO authenticated
  USING (has_company_role(company_id, ARRAY[]::company_role_enum[]))
  WITH CHECK (has_company_role(company_id, ARRAY[]::company_role_enum[]));

-- -----------------------------------------------------------------------------
-- LISTINGS
-- -----------------------------------------------------------------------------
CREATE POLICY listings_select ON b2b_listings FOR SELECT TO authenticated
  USING (approval_status = 'approved' OR is_company_member(company_id));

CREATE POLICY listings_insert ON b2b_listings FOR INSERT TO authenticated
  WITH CHECK (
    approval_status = 'draft'
    AND created_by_user_id = auth.uid()
    AND has_company_role(company_id, ARRAY['procurement_officer','logistics_manager']::company_role_enum[])
  );

-- Content edits only while draft/rejected; can never self-approve.
CREATE POLICY listings_update ON b2b_listings FOR UPDATE TO authenticated
  USING (can_edit_listing(id))
  WITH CHECK (approval_status IN ('draft', 'rejected') AND status = 'open');

CREATE POLICY listings_delete ON b2b_listings FOR DELETE TO authenticated
  USING (approval_status = 'draft' AND has_company_role(company_id, ARRAY['procurement_officer']::company_role_enum[]));

-- Detail tables: readable when the parent is readable, writable when the parent is editable.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'freight_dispatches','plant_machinery_details','fuel_procurement_details',
    'storage_facility_details','sla_service_details','agri_offtake_details','commercial_property_details'
  ] LOOP
    EXECUTE format($p$
      CREATE POLICY %1$s_select ON public.%1$I FOR SELECT TO authenticated
        USING (EXISTS (SELECT 1 FROM public.b2b_listings l WHERE l.id = listing_id));
      CREATE POLICY %1$s_write ON public.%1$I FOR ALL TO authenticated
        USING (public.can_edit_listing(listing_id))
        WITH CHECK (public.can_edit_listing(listing_id));
    $p$, t);
  END LOOP;
END $$;

-- Drivers can see the dispatch they're assigned to even before it's public to them.
CREATE POLICY freight_driver_select ON freight_dispatches FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid() OR is_company_member(carrier_company_id));

-- -----------------------------------------------------------------------------
-- ATTACHMENTS + STORAGE
-- -----------------------------------------------------------------------------
CREATE POLICY attachments_select ON attachments FOR SELECT TO authenticated
  USING (
    is_company_member(company_id)
    OR EXISTS (SELECT 1 FROM b2b_listings l WHERE l.id = listing_id AND l.approval_status = 'approved')
  );
CREATE POLICY attachments_insert ON attachments FOR INSERT TO authenticated
  WITH CHECK (is_company_member(company_id) AND uploaded_by = auth.uid()
              AND storage_path LIKE company_id::TEXT || '/%');
CREATE POLICY attachments_delete ON attachments FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('b2b-docs', 'b2b-docs', FALSE, 26214400,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
ON CONFLICT (id) DO NOTHING;

-- Uploads land under '<company_id>/...'; reads follow the attachments row.
CREATE POLICY b2b_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'b2b-docs'
              AND (storage.foldername(name))[1]::UUID IN (SELECT public.auth_company_ids()));
CREATE POLICY b2b_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'b2b-docs'
         AND EXISTS (SELECT 1 FROM public.attachments a WHERE a.storage_path = name));

-- -----------------------------------------------------------------------------
-- SEALED RFQ PROPOSALS
-- -----------------------------------------------------------------------------
-- Vendors always see their own. Buyers see all proposals only AFTER bidding closes.
CREATE POLICY proposals_select ON rfq_proposals FOR SELECT TO authenticated
  USING (
    is_company_member(vendor_company_id)
    OR EXISTS (
      SELECT 1 FROM b2b_listings l
      WHERE l.id = listing_id
        AND is_company_member(l.company_id)
        AND l.bidding_closes_at <= NOW()
    )
  );

CREATE POLICY proposals_insert ON rfq_proposals FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by_user_id = auth.uid()
    AND status = 'submitted' AND is_winning_bid = FALSE
    AND has_company_role(vendor_company_id, ARRAY['procurement_officer','logistics_manager']::company_role_enum[])
    AND EXISTS (
      SELECT 1 FROM b2b_listings l
      WHERE l.id = listing_id
        AND l.approval_status = 'approved' AND l.status = 'open'
        AND l.bidding_closes_at > NOW()
        AND l.company_id <> vendor_company_id
        AND l.listing_type <> 'asset_auction'
    )
  );

-- Vendors may revise or withdraw until close.
CREATE POLICY proposals_update ON rfq_proposals FOR UPDATE TO authenticated
  USING (has_company_role(vendor_company_id, ARRAY['procurement_officer','logistics_manager']::company_role_enum[]))
  WITH CHECK (
    status IN ('submitted', 'withdrawn') AND is_winning_bid = FALSE
    AND EXISTS (SELECT 1 FROM b2b_listings l
                WHERE l.id = listing_id AND l.status = 'open' AND l.bidding_closes_at > NOW())
  );

-- Proposal identity is immutable once created.
CREATE OR REPLACE FUNCTION freeze_proposal_identity() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.listing_id <> OLD.listing_id OR NEW.vendor_company_id <> OLD.vendor_company_id THEN
    RAISE EXCEPTION 'listing_id and vendor_company_id are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_identity BEFORE UPDATE ON rfq_proposals
  FOR EACH ROW EXECUTE FUNCTION freeze_proposal_identity();

-- Buyers get a count (not amounts) while bidding is still sealed.
CREATE OR REPLACE FUNCTION public.rfq_bid_count(p_listing UUID) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COUNT(*)::INT FROM public.rfq_proposals p
  JOIN public.b2b_listings l ON l.id = p.listing_id
  WHERE p.listing_id = p_listing AND p.status = 'submitted'
    AND (public.is_company_member(l.company_id) OR l.approval_status = 'approved')
$$;

-- -----------------------------------------------------------------------------
-- OPEN AUCTION BIDS
-- -----------------------------------------------------------------------------
CREATE POLICY auction_bids_select ON auction_bids FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM b2b_listings l WHERE l.id = listing_id));

CREATE POLICY auction_bids_insert ON auction_bids FOR INSERT TO authenticated
  WITH CHECK (
    bidder_user_id = auth.uid()
    AND has_company_role(bidder_company_id, ARRAY['procurement_officer']::company_role_enum[])
  );

-- Serialise bids per listing and enforce ascending amounts / open window.
CREATE OR REPLACE FUNCTION validate_auction_bid() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.b2b_listings%ROWTYPE;
  top NUMERIC;
BEGIN
  SELECT * INTO l FROM public.b2b_listings WHERE id = NEW.listing_id FOR UPDATE;
  IF l.listing_type <> 'asset_auction' OR l.approval_status <> 'approved'
     OR l.status <> 'open' OR l.bidding_closes_at <= NOW() THEN
    RAISE EXCEPTION 'Auction is not open for bidding' USING ERRCODE = 'P0001';
  END IF;
  IF l.company_id = NEW.bidder_company_id THEN
    RAISE EXCEPTION 'Sellers cannot bid on their own auction' USING ERRCODE = 'P0001';
  END IF;
  SELECT MAX(amount) INTO top FROM public.auction_bids WHERE listing_id = NEW.listing_id;
  IF NEW.amount <= COALESCE(top, 0) THEN
    RAISE EXCEPTION 'Bid must exceed current high bid of %', top USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_bid BEFORE INSERT ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION validate_auction_bid();

-- -----------------------------------------------------------------------------
-- FINANCE / INVOICES / ESCROW / COMMUTE
-- -----------------------------------------------------------------------------
CREATE POLICY tf_select ON trade_finance_requests FOR SELECT TO authenticated
  USING (is_company_member(company_id));
CREATE POLICY tf_insert ON trade_finance_requests FOR INSERT TO authenticated
  WITH CHECK (status = 'under_review' AND requested_by_user_id = auth.uid()
              AND has_company_role(company_id, ARRAY['finance_approver']::company_role_enum[]));

CREATE POLICY invoices_select ON invoices FOR SELECT TO authenticated
  USING (is_company_member(issuer_company_id) OR is_company_member(payer_company_id));
CREATE POLICY invoices_insert ON invoices FOR INSERT TO authenticated
  WITH CHECK (status = 'draft' AND has_company_role(issuer_company_id, ARRAY['finance_approver']::company_role_enum[]));
CREATE POLICY invoices_update ON invoices FOR UPDATE TO authenticated
  USING (status = 'draft' AND has_company_role(issuer_company_id, ARRAY['finance_approver']::company_role_enum[]))
  WITH CHECK (status IN ('draft', 'issued'));

-- Escrow is read-only to clients; movements happen via service role / payment webhooks.
CREATE POLICY escrow_select ON escrow_transactions FOR SELECT TO authenticated
  USING (is_company_member(payer_company_id) OR is_company_member(payee_company_id));

CREATE POLICY commute_select ON commute_routes FOR SELECT TO authenticated
  USING (is_company_member(company_id) OR is_company_member(operator_company_id));
CREATE POLICY commute_write ON commute_routes FOR ALL TO authenticated
  USING (has_company_role(company_id, ARRAY['logistics_manager']::company_role_enum[]))
  WITH CHECK (has_company_role(company_id, ARRAY['logistics_manager']::company_role_enum[]));

-- Approvals and audit: read-only to clients; written only by RPCs/triggers.
CREATE POLICY approvals_select ON approval_requests FOR SELECT TO authenticated
  USING (is_company_member(company_id));
CREATE POLICY audit_select ON system_audit_logs FOR SELECT TO authenticated
  USING (has_company_role(company_id, ARRAY['finance_approver']::company_role_enum[]));

-- Append-only, even for the table owner path through PostgREST.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'system_audit_logs is append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON system_audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- -----------------------------------------------------------------------------
-- RPC: onboarding
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_company(
  p_name TEXT, p_registration_number TEXT, p_type public.company_type_enum,
  p_vat_tax_id TEXT DEFAULT NULL, p_head_office_city TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cid UUID; bid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.companies(company_name, registration_number, company_type, vat_tax_id)
  VALUES (p_name, p_registration_number, p_type, p_vat_tax_id) RETURNING id INTO cid;
  INSERT INTO public.company_branches(company_id, branch_name, city, is_head_office)
  VALUES (cid, 'Head Office', p_head_office_city, TRUE) RETURNING id INTO bid;
  INSERT INTO public.company_users(company_id, branch_id, user_id, role)
  VALUES (cid, bid, auth.uid(), 'admin');
  PERFORM public.write_audit(cid, 'company.created', 'companies', cid, jsonb_build_object('name', p_name));
  RETURN cid;
END $$;

-- -----------------------------------------------------------------------------
-- RPC: multi-tier listing approval
-- -----------------------------------------------------------------------------
-- Steps generated:
--   1. procurement_officer review  (skipped if submitter is one — admin always counts)
--   2. finance_approver            (only when budget > company threshold, or escrow terms)
--   3. admin                       (asset auctions: disposal of company assets)
-- Zero steps required → approved immediately.
CREATE OR REPLACE FUNCTION public.submit_listing_for_approval(p_listing UUID) RETURNS public.approval_status_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.b2b_listings%ROWTYPE;
  c public.companies%ROWTYPE;
  step SMALLINT := 0;
  submitter_role public.company_role_enum;
BEGIN
  SELECT * INTO l FROM public.b2b_listings WHERE id = p_listing FOR UPDATE;
  IF NOT FOUND OR NOT public.can_edit_listing(p_listing) THEN
    RAISE EXCEPTION 'Listing not found or not editable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.companies WHERE id = l.company_id;
  SELECT role INTO submitter_role FROM public.company_users
   WHERE company_id = l.company_id AND user_id = auth.uid();

  DELETE FROM public.approval_requests WHERE entity_type = 'listing' AND entity_id = p_listing;

  IF submitter_role NOT IN ('procurement_officer', 'admin') THEN
    step := step + 1;
    INSERT INTO public.approval_requests(company_id, entity_type, entity_id, step_order, required_role, requested_by)
    VALUES (l.company_id, 'listing', p_listing, step, 'procurement_officer', auth.uid());
  END IF;
  IF COALESCE(l.budget_or_target_price, 0) > c.finance_approval_threshold OR l.payment_terms = 'escrow' THEN
    step := step + 1;
    INSERT INTO public.approval_requests(company_id, entity_type, entity_id, step_order, required_role, requested_by)
    VALUES (l.company_id, 'listing', p_listing, step, 'finance_approver', auth.uid());
  END IF;
  IF l.listing_type = 'asset_auction' THEN
    step := step + 1;
    INSERT INTO public.approval_requests(company_id, entity_type, entity_id, step_order, required_role, requested_by)
    VALUES (l.company_id, 'listing', p_listing, step, 'admin', auth.uid());
  END IF;

  UPDATE public.b2b_listings
     SET approval_status = CASE WHEN step = 0 THEN 'approved' ELSE 'pending_approval' END::public.approval_status_enum
   WHERE id = p_listing;

  PERFORM public.write_audit(l.company_id, 'listing.submitted', 'b2b_listings', p_listing,
                             jsonb_build_object('steps', step));
  RETURN CASE WHEN step = 0 THEN 'approved' ELSE 'pending_approval' END::public.approval_status_enum;
END $$;

CREATE OR REPLACE FUNCTION public.decide_approval(p_request UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS public.approval_status_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.approval_requests%ROWTYPE;
  next_pending INT;
  outcome public.approval_status_enum := 'pending_approval';
  creator UUID;
BEGIN
  SELECT * INTO r FROM public.approval_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN
    RAISE EXCEPTION 'Approval request not pending';
  END IF;
  IF NOT public.has_company_role(r.company_id, ARRAY[r.required_role]) THEN
    RAISE EXCEPTION 'Requires role %', r.required_role USING ERRCODE = '42501';
  END IF;
  -- Steps must be decided in order.
  IF EXISTS (SELECT 1 FROM public.approval_requests
             WHERE entity_type = r.entity_type AND entity_id = r.entity_id
               AND status = 'pending' AND step_order < r.step_order) THEN
    RAISE EXCEPTION 'An earlier approval step is still pending';
  END IF;
  -- Segregation of duties: no approving your own submission.
  IF r.entity_type = 'listing' THEN
    SELECT created_by_user_id INTO creator FROM public.b2b_listings WHERE id = r.entity_id;
    IF creator = auth.uid() THEN
      RAISE EXCEPTION 'You cannot approve a listing you created' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.approval_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END::public.approval_step_status,
         decided_by = auth.uid(), decision_note = p_note, decided_at = NOW()
   WHERE id = p_request;

  IF NOT p_approve THEN
    UPDATE public.approval_requests SET status = 'skipped'
     WHERE entity_type = r.entity_type AND entity_id = r.entity_id AND status = 'pending';
    outcome := 'rejected';
  ELSE
    SELECT COUNT(*) INTO next_pending FROM public.approval_requests
     WHERE entity_type = r.entity_type AND entity_id = r.entity_id AND status = 'pending';
    IF next_pending = 0 THEN outcome := 'approved'; END IF;
  END IF;

  IF r.entity_type = 'listing' AND outcome <> 'pending_approval' THEN
    UPDATE public.b2b_listings SET approval_status = outcome WHERE id = r.entity_id;
  END IF;

  PERFORM public.write_audit(r.company_id, 'approval.' || CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
                             'approval_requests', r.id,
                             jsonb_build_object('entity_id', r.entity_id, 'step', r.step_order, 'note', p_note));
  RETURN outcome;
END $$;

-- -----------------------------------------------------------------------------
-- RPC: award a sealed RFQ
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

  IF NOT public.has_company_role(l.company_id, ARRAY['procurement_officer']::public.company_role_enum[]) THEN
    RAISE EXCEPTION 'Only the buyer''s procurement team can award' USING ERRCODE = '42501';
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

  PERFORM public.write_audit(l.company_id, 'rfq.awarded', 'b2b_listings', l.id,
    jsonb_build_object('proposal_id', p_proposal, 'vendor_company_id', p.vendor_company_id,
                       'bid_amount', p.bid_amount, 'currency', p.currency, 'reason', p_reason));
  PERFORM public.write_audit(p.vendor_company_id, 'rfq.won', 'rfq_proposals', p_proposal, '{}');
END $$;

-- -----------------------------------------------------------------------------
-- RPC: ePoD confirmation by assigned driver / carrier
-- -----------------------------------------------------------------------------
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
  UPDATE public.freight_dispatches
     SET dispatch_status = 'delivered', proof_of_delivery_attachment_id = p_pod_attachment, delivered_at = NOW()
   WHERE id = f.id;
  SELECT company_id INTO buyer FROM public.b2b_listings WHERE id = p_listing;
  PERFORM public.write_audit(buyer, 'freight.delivered', 'freight_dispatches', f.id,
                             jsonb_build_object('pod_attachment_id', p_pod_attachment));
END $$;

-- -----------------------------------------------------------------------------
-- GENERIC AUDIT TRIGGERS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rec JSONB := to_jsonb(COALESCE(NEW, OLD));
  cid UUID := COALESCE(rec->>'company_id', rec->>'vendor_company_id', rec->>'bidder_company_id')::UUID;
BEGIN
  INSERT INTO public.system_audit_logs(company_id, user_id, action_type, entity_table, entity_id, details)
  VALUES (cid, auth.uid(), TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, (rec->>'id')::UUID,
          CASE TG_OP WHEN 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
                     ELSE rec END);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON b2b_listings           FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON rfq_proposals          FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit AFTER INSERT                     ON auction_bids           FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON trade_finance_requests FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON company_users          FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE           ON invoices               FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- -----------------------------------------------------------------------------
-- RPC GRANTS + REALTIME
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_company, public.submit_listing_for_approval,
  public.decide_approval, public.award_proposal, public.confirm_delivery, public.rfq_bid_count FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company, public.submit_listing_for_approval,
  public.decide_approval, public.award_proposal, public.confirm_delivery, public.rfq_bid_count TO authenticated;

-- Realtime respects RLS, so sealed proposals are not broadcast to buyers early.
ALTER PUBLICATION supabase_realtime ADD TABLE auction_bids, approval_requests, rfq_proposals, freight_dispatches;
