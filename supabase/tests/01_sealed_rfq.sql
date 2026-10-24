-- Sealed RFQ: approval workflow, sealed visibility, award, post-close lock, audit trail.
\set a  '''00000000-0000-0000-0000-00000000000a'''
\set po '''00000000-0000-0000-0000-00000000000b'''
\set fin '''00000000-0000-0000-0000-00000000000f'''
\set ven '''00000000-0000-0000-0000-00000000000c'''
INSERT INTO auth.users(id, email) VALUES (:a, 'admin@buyer.zw'), (:po, 'po@buyer.zw'), (:fin, 'fin@buyer.zw'), (:ven, 'sales@vendor.zw');
SET ROLE authenticated;

SELECT pg_temp.as_user(:a);
SELECT create_company('Buyer Mining', 'REG-1', 'buyer') AS buyer \gset
SELECT add_company_member(:'buyer', 'po@buyer.zw', 'procurement_officer');
SELECT add_company_member(:'buyer', 'fin@buyer.zw', 'finance_approver');
SELECT pg_temp.as_user(:ven);
SELECT create_company('Vendor Supplies', 'REG-2', 'supplier') AS vendor \gset

SELECT pg_temp.as_user(:po);
SELECT (create_listing(:'buyer', jsonb_build_object(
  'title', '500 t cement', 'category', 'construction', 'listing_type', 'rfq_procurement',
  'budget_or_target_price', 20000, 'bidding_closes_at', now() + interval '2 seconds'), NULL, FALSE)) ->> 'id' AS lid \gset
SELECT pg_temp.fails(format($q$UPDATE b2b_listings SET approval_status = 'approved' WHERE id = %L$q$, :'lid'),
                     'creator cannot self-approve via UPDATE', '%row-level security%');
SELECT pg_temp.ok(submit_listing_for_approval(:'lid') = 'pending_approval', 'over-threshold RFQ needs finance approval');

SELECT pg_temp.as_user(:ven);
SELECT pg_temp.ok((SELECT count(*) FROM b2b_listings WHERE id = :'lid') = 0, 'vendors cannot see unapproved listings');

SELECT pg_temp.as_user(:fin);
SELECT id AS rid FROM approval_requests WHERE entity_id = :'lid' \gset
SELECT pg_temp.ok(decide_approval(:'rid', TRUE, 'within budget') = 'approved', 'finance approval publishes the listing');

SELECT pg_temp.as_user(:ven);
INSERT INTO rfq_proposals(listing_id, vendor_company_id, submitted_by_user_id, bid_amount, delivery_timeline_days)
VALUES (:'lid', :'vendor', auth.uid(), 18500, 14) RETURNING id AS pid \gset
SELECT pg_temp.fails(format($q$INSERT INTO rfq_proposals(listing_id, vendor_company_id, submitted_by_user_id, bid_amount, delivery_timeline_days) VALUES (%L, %L, auth.uid(), 1, 1)$q$, :'lid', :'buyer'),
                     'vendor cannot bid as another company', '%row-level security%');

SELECT pg_temp.as_user(:po);
SELECT pg_temp.ok((SELECT count(*) FROM rfq_proposals WHERE listing_id = :'lid') = 0, 'buyer cannot see sealed bids before close');
SELECT pg_temp.ok(rfq_bid_count(:'lid') = 1, 'buyer can see bid count while sealed');
SELECT pg_temp.fails(format('SELECT award_proposal(%L)', :'pid'), 'cannot award while bidding is open', '%still open%');

SELECT pg_sleep(2.2);
SELECT pg_temp.ok((SELECT count(*) FROM rfq_proposals WHERE listing_id = :'lid') = 1, 'bids revealed after close');
SELECT award_proposal(:'pid', 'lowest compliant');
SELECT pg_temp.ok((SELECT status FROM b2b_listings WHERE id = :'lid') = 'awarded', 'listing marked awarded');
SELECT pg_temp.ok((SELECT is_winning_bid AND status = 'won' FROM rfq_proposals WHERE id = :'pid'), 'proposal marked won');

SELECT pg_temp.as_user(:ven);
SELECT pg_temp.fails(format('UPDATE rfq_proposals SET bid_amount = 1 WHERE id = %L', :'pid'),
                     'bids are locked after close', '%row-level security%');

SELECT pg_temp.as_user(:fin);
SELECT pg_temp.ok((SELECT array_agg(action_type ORDER BY id) @> ARRAY['listing.submitted', 'approval.approved', 'rfq.awarded']
                     FROM system_audit_logs WHERE company_id = :'buyer'), 'audit trail recorded');
SELECT pg_temp.affects_none('DELETE FROM system_audit_logs', 'audit log is not deletable by clients');
RESET ROLE;
SELECT pg_temp.fails('DELETE FROM system_audit_logs', 'audit log is append-only even for the owner', '%append-only%');
