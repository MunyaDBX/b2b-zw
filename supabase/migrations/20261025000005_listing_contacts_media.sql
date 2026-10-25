-- =============================================================================
-- B2B ZW — 0005 Listing contact details, safer attachments, unregistered companies
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enquiry contact details on listings (WhatsApp column already exists)
-- -----------------------------------------------------------------------------
ALTER TABLE b2b_listings
  ADD COLUMN contact_person  TEXT CHECK (char_length(contact_person) <= 120),
  ADD COLUMN contact_phone   VARCHAR(16) CHECK (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD COLUMN contact_email   TEXT CHECK (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN contact_address TEXT CHECK (char_length(contact_address) <= 300);

-- -----------------------------------------------------------------------------
-- Attachments: only attach files to your own company's listings, and bound sizes.
-- (Previously any member could point an attachment at any listing.)
-- -----------------------------------------------------------------------------
DROP POLICY attachments_insert ON attachments;
CREATE POLICY attachments_insert ON attachments FOR INSERT TO authenticated
  WITH CHECK (
    is_company_member(company_id)
    AND uploaded_by = auth.uid()
    AND storage_path LIKE company_id::TEXT || '/%'
    AND (listing_id IS NULL
         OR EXISTS (SELECT 1 FROM b2b_listings l WHERE l.id = listing_id AND l.company_id = attachments.company_id))
  );

ALTER TABLE attachments ADD CONSTRAINT attachments_size_limit CHECK (size_bytes <= 10 * 1024 * 1024);
ALTER TABLE attachments ADD COLUMN sort_order SMALLINT NOT NULL DEFAULT 0;

-- At most 8 files per listing.
CREATE OR REPLACE FUNCTION limit_listing_attachments() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.listing_id IS NOT NULL
     AND (SELECT count(*) FROM attachments WHERE listing_id = NEW.listing_id) >= 8 THEN
    RAISE EXCEPTION 'A listing can have at most 8 attachments' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER limit_attachments BEFORE INSERT ON attachments
  FOR EACH ROW EXECUTE FUNCTION limit_listing_attachments();

-- Storage bucket: 10 MB per file to match.
UPDATE storage.buckets SET file_size_limit = 10 * 1024 * 1024 WHERE id = 'b2b-docs';

-- -----------------------------------------------------------------------------
-- Unregistered (informal) businesses get a platform reference instead of a reg. number.
-- -----------------------------------------------------------------------------
ALTER TABLE companies ADD COLUMN is_registered BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION public.create_company(
  p_name TEXT, p_registration_number TEXT, p_type public.company_type_enum,
  p_vat_tax_id TEXT DEFAULT NULL, p_head_office_city TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cid UUID; bid UUID;
  reg TEXT := NULLIF(trim(p_registration_number), '');
  registered BOOLEAN := reg IS NOT NULL;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF registered AND char_length(reg) < 3 THEN
    RAISE EXCEPTION 'Registration number looks too short';
  END IF;
  IF NOT registered THEN
    -- e.g. UNREG-2026-7F3A9C: unique, readable over the phone, never collides with real numbers.
    LOOP
      reg := 'UNREG-' || to_char(NOW(), 'YYYY') || '-'
             || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE registration_number = reg);
    END LOOP;
  END IF;

  INSERT INTO public.companies(company_name, registration_number, company_type, vat_tax_id, is_registered)
  VALUES (p_name, upper(reg), p_type, p_vat_tax_id, registered) RETURNING id INTO cid;
  INSERT INTO public.company_branches(company_id, branch_name, city, is_head_office)
  VALUES (cid, 'Head Office', p_head_office_city, TRUE) RETURNING id INTO bid;
  INSERT INTO public.company_users(company_id, branch_id, user_id, role)
  VALUES (cid, bid, auth.uid(), 'admin');
  PERFORM public.write_audit(cid, 'company.created', 'companies', cid,
                             jsonb_build_object('name', p_name, 'registered', registered));
  RETURN cid;
END $$;
