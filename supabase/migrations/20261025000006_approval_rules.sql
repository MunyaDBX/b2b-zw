-- =============================================================================
-- B2B ZW — 0006 Opt-in approval rules
-- =============================================================================
-- Approvals used to trigger automatically (budget > 5000, escrow terms, asset auctions).
-- Now each company's admin decides:
--   * approval_required_types: post types that always need sign-off before going live
--     (approved by a procurement officer or admin other than the author);
--   * finance_approval_threshold: optional; budgets above it also need a finance approver.
-- With neither set (the default) every post goes live immediately.

ALTER TABLE companies
  ADD COLUMN approval_required_types public.b2b_listing_type[] NOT NULL DEFAULT '{}';
ALTER TABLE companies ALTER COLUMN finance_approval_threshold DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN finance_approval_threshold SET DEFAULT NULL;
ALTER TABLE companies ADD CONSTRAINT finance_threshold_positive CHECK (finance_approval_threshold IS NULL OR finance_approval_threshold > 0);
-- Existing companies start with approvals off, matching new ones.
UPDATE companies SET finance_approval_threshold = NULL;

-- Admin-editable (companies_update policy already limits UPDATE to admins).
GRANT UPDATE (approval_required_types, finance_approval_threshold) ON companies TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_listing_for_approval(p_listing UUID) RETURNS public.approval_status_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.b2b_listings%ROWTYPE;
  c public.companies%ROWTYPE;
  step SMALLINT := 0;
  rule TEXT[] := '{}';
BEGIN
  SELECT * INTO l FROM public.b2b_listings WHERE id = p_listing FOR UPDATE;
  IF NOT FOUND OR NOT public.can_edit_listing(p_listing) THEN
    RAISE EXCEPTION 'Listing not found or not editable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.companies WHERE id = l.company_id;

  DELETE FROM public.approval_requests WHERE entity_type = 'listing' AND entity_id = p_listing;

  IF l.listing_type = ANY(c.approval_required_types) THEN
    step := step + 1;
    rule := array_append(rule, 'post_type');
    INSERT INTO public.approval_requests(company_id, entity_type, entity_id, step_order, required_role, requested_by)
    VALUES (l.company_id, 'listing', p_listing, step, 'procurement_officer', auth.uid());
  END IF;
  IF c.finance_approval_threshold IS NOT NULL AND COALESCE(l.budget_or_target_price, 0) > c.finance_approval_threshold THEN
    step := step + 1;
    rule := array_append(rule, 'budget_threshold');
    INSERT INTO public.approval_requests(company_id, entity_type, entity_id, step_order, required_role, requested_by)
    VALUES (l.company_id, 'listing', p_listing, step, 'finance_approver', auth.uid());
  END IF;

  UPDATE public.b2b_listings
     SET approval_status = CASE WHEN step = 0 THEN 'approved' ELSE 'pending_approval' END::public.approval_status_enum
   WHERE id = p_listing;

  PERFORM public.write_audit(l.company_id, 'listing.submitted', 'b2b_listings', p_listing,
                             jsonb_build_object('steps', step, 'rules', rule));
  RETURN CASE WHEN step = 0 THEN 'approved' ELSE 'pending_approval' END::public.approval_status_enum;
END $$;
