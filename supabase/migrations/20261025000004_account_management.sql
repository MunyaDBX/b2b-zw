-- =============================================================================
-- B2B ZW — 0004 Self-service account deletion
-- =============================================================================
-- Deleting your account:
--   * companies where you are the ONLY member are deleted with you (nobody else
--     could ever administer them);
--   * companies with other members are kept; if you are their last admin the
--     keep_one_admin trigger blocks the deletion, so promote someone first.
-- Audit rows keep their history (user_id is SET NULL by the FK).

CREATE OR REPLACE FUNCTION public.delete_my_account() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid UUID := auth.uid();
  blocking TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT string_agg(c.company_name, ', ') INTO blocking
    FROM public.company_users me
    JOIN public.companies c ON c.id = me.company_id
   WHERE me.user_id = uid AND me.role = 'admin'
     AND EXISTS (SELECT 1 FROM public.company_users o WHERE o.company_id = me.company_id AND o.user_id <> uid)
     AND NOT EXISTS (SELECT 1 FROM public.company_users o
                      WHERE o.company_id = me.company_id AND o.user_id <> uid AND o.role = 'admin');
  IF blocking IS NOT NULL THEN
    RAISE EXCEPTION 'You are the only admin of %. Make another member an admin first.', blocking
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.companies c
   WHERE EXISTS (SELECT 1 FROM public.company_users me WHERE me.company_id = c.id AND me.user_id = uid)
     AND NOT EXISTS (SELECT 1 FROM public.company_users o WHERE o.company_id = c.id AND o.user_id <> uid);

  INSERT INTO public.system_audit_logs(user_id, action_type, details)
  VALUES (NULL, 'account.deleted', jsonb_build_object('user_id', uid));

  DELETE FROM auth.users WHERE id = uid;
END $$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account TO authenticated;

-- Deleting a company or user cascades to rows whose audit trigger would log against the
-- company/user being deleted (FK violation). Keep the row, but drop the dangling links.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rec JSONB := to_jsonb(COALESCE(NEW, OLD));
  cid UUID := COALESCE(rec->>'company_id', rec->>'vendor_company_id', rec->>'bidder_company_id')::UUID;
  uid UUID := auth.uid();
BEGIN
  IF cid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = cid) THEN
    cid := NULL;
  END IF;
  IF uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    uid := NULL;
  END IF;
  INSERT INTO public.system_audit_logs(company_id, user_id, action_type, entity_table, entity_id, details)
  VALUES (cid, uid, TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, (rec->>'id')::UUID,
          CASE TG_OP WHEN 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
                     ELSE rec END);
  RETURN COALESCE(NEW, OLD);
END $$;

-- The audit log stays append-only, except for the FK's own ON DELETE SET NULL:
-- deleting a user or company must be able to blank user_id / company_id on old rows.
-- (Previously any user deletion — even from the dashboard — failed here.)
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'user_id' - 'company_id') = (to_jsonb(OLD) - 'user_id' - 'company_id')
     AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id OR NEW.user_id IS NULL)
     AND (NEW.company_id IS NOT DISTINCT FROM OLD.company_id OR NEW.company_id IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'system_audit_logs is append-only';
END $$;
