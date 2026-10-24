-- Assertion helpers. Any failure raises, and run.sh uses ON_ERROR_STOP, so the suite stops at the first broken expectation.
CREATE FUNCTION pg_temp.as_user(u UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u::TEXT, FALSE)
$$;

CREATE FUNCTION pg_temp.ok(cond BOOLEAN, label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'ok - %', label;
END $$;

-- Runs p_sql as the current role and passes only if it raises (optionally matching p_like).
CREATE FUNCTION pg_temp.fails(p_sql TEXT, label TEXT, p_like TEXT DEFAULT '%') RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_like THEN RAISE EXCEPTION 'FAIL: % (raised "%", expected like "%")', label, SQLERRM, p_like; END IF;
    RAISE NOTICE 'ok - % (blocked: %)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement succeeded but should have been blocked)', label;
END $$;

-- Passes if p_sql runs but RLS lets it touch zero rows (silent filtering, not an error).
CREATE FUNCTION pg_temp.affects_none(p_sql TEXT, label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % (% rows affected)', label, n; END IF;
  RAISE NOTICE 'ok - % (0 rows affected)', label;
END $$;
