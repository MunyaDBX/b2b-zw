-- Self-service account deletion: solo companies go with the user, shared ones need another admin.
\set solo  '''00000000-0000-0000-0000-0000000000b1'''
\set boss  '''00000000-0000-0000-0000-0000000000b2'''
\set staff '''00000000-0000-0000-0000-0000000000b3'''
INSERT INTO auth.users(id, email) VALUES (:solo, 'solo@x.zw'), (:boss, 'boss@y.zw'), (:staff, 'staff@y.zw');
SET ROLE authenticated;

SELECT pg_temp.as_user(:solo);
SELECT create_company('Solo Traders', 'S-0001', 'supplier') AS solo_co \gset
SELECT delete_my_account();
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :solo), 'user deleted');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM companies WHERE id = :'solo_co'), 'sole-member company deleted with the user');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM system_audit_logs WHERE action_type = 'account.deleted'), 'deletion audited');

SET ROLE authenticated;
SELECT pg_temp.as_user(:boss);
SELECT create_company('Shared Logistics', 'S-0002', 'logistics_provider') AS shared_co \gset
SELECT add_company_member(:'shared_co', 'staff@y.zw', 'driver');
SELECT pg_temp.fails('SELECT delete_my_account()', 'last admin of a shared company cannot leave', '%only admin of Shared Logistics%');

SELECT pg_temp.as_user(:staff);
SELECT delete_my_account();
RESET ROLE;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM companies WHERE id = :'shared_co'), 'shared company survives a member leaving');
SELECT pg_temp.ok((SELECT count(*) FROM company_users WHERE company_id = :'shared_co') = 1, 'membership removed');

SET ROLE anon;
SELECT pg_temp.fails('SELECT delete_my_account()', 'anonymous callers cannot call it', '%permission denied%');
RESET ROLE;

-- Anonymisation is the only permitted change.
SELECT pg_temp.fails('UPDATE system_audit_logs SET action_type = ''tampered''', 'audit rows still cannot be edited', '%append-only%');
SELECT pg_temp.fails('UPDATE system_audit_logs SET user_id = gen_random_uuid() WHERE user_id IS NOT NULL', 'audit user cannot be reassigned', '%');
SELECT pg_temp.fails('DELETE FROM system_audit_logs', 'audit rows still cannot be deleted', '%append-only%');
