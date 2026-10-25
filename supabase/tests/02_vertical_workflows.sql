-- Freight + escrow, auctions with sealed reserve, membership rules, trade finance review.
\set a   '''00000000-0000-0000-0000-0000000000a1'''
\set a2  '''00000000-0000-0000-0000-0000000000a2'''
\set fin '''00000000-0000-0000-0000-0000000000f1'''
\set car '''00000000-0000-0000-0000-0000000000c1'''
\set drv '''00000000-0000-0000-0000-0000000000d1'''
\set ops '''00000000-0000-0000-0000-0000000000e1'''
INSERT INTO auth.users(id, email) VALUES (:a, 'a@buyer.zw'), (:a2, 'a2@buyer.zw'), (:fin, 'f@buyer.zw'),
  (:car, 'c@carrier.zw'), (:drv, 'driver@carrier.zw'), (:ops, 'ops@b2bzw.co.zw');
INSERT INTO platform_admins VALUES (:ops);
SET ROLE authenticated;

-- Membership ----------------------------------------------------------------------
SELECT pg_temp.as_user(:a);
SELECT create_company('Buyer Mining', 'R-0001', 'buyer') AS buyer \gset
SELECT add_company_member(:'buyer', 'F@BUYER.ZW', 'finance_approver');
SELECT add_company_member(:'buyer', 'a2@buyer.zw', 'admin');
SELECT pg_temp.ok((SELECT count(*) FROM list_company_members(:'buyer')) = 3, 'members listed with emails (case-insensitive add)');
SELECT pg_temp.fails(format($q$SELECT add_company_member(%L, 'nobody@x.zw', 'driver')$q$, :'buyer'),
                     'cannot add unknown email', '%sign up first%');
SELECT pg_temp.as_user(:car);
SELECT create_company('Carrier Haulage', 'R-0002', 'logistics_provider') AS carrier \gset
SELECT add_company_member(:'carrier', 'driver@carrier.zw', 'driver');
SELECT pg_temp.fails(format($q$UPDATE company_users SET role = 'driver' WHERE company_id = %L AND user_id = auth.uid()$q$, :'carrier'),
                     'last admin cannot be demoted', '%at least one admin%');
SELECT pg_temp.fails(format($q$SELECT add_company_member(%L, 'c@carrier.zw', 'admin')$q$, :'buyer'),
                     'non-admins cannot add members elsewhere', '%Admins only%');

-- Freight with escrow ------------------------------------------------------------
SELECT pg_temp.as_user(:a);
SELECT create_listing(:'buyer',
  jsonb_build_object('title', '28 t machinery Harare-Beira', 'category', 'freight', 'listing_type', 'freight_haulage',
                     'budget_or_target_price', 3000, 'payment_terms', 'escrow', 'bidding_closes_at', now() + interval '2 seconds'),
  jsonb_build_object('origin_address', 'Harare', 'destination_address', 'Beira', 'cargo_type', 'heavy_machinery',
                     'required_truck_type', '30ton_flatbed', 'cargo_weight_tonnes', 28, 'dispatch_status', 'delivered')) AS res \gset
SELECT (:'res'::jsonb) ->> 'id' AS fl \gset
SELECT pg_temp.ok((:'res'::jsonb) ->> 'approval_status' = 'pending_approval', 'escrow terms require finance approval');
SELECT pg_temp.ok(get_listing_details(:'fl') ->> 'dispatch_status' = 'posted', 'workflow columns cannot be set at creation');
SELECT pg_temp.fails(format($q$SELECT create_listing(%L, '{"title":"x y z","category":"c","listing_type":"freight_haulage"}')$q$, :'buyer'),
                     'detail-backed listings require details', '%require details%');
SELECT pg_temp.as_user(:fin);
SELECT decide_approval(id, TRUE) FROM approval_requests WHERE entity_id = :'fl';

SELECT pg_temp.as_user(:car);
INSERT INTO rfq_proposals(listing_id, vendor_company_id, submitted_by_user_id, bid_amount, delivery_timeline_days)
VALUES (:'fl', :'carrier', auth.uid(), 2800, 3) RETURNING id AS pid \gset
SELECT pg_sleep(2.2);
SELECT pg_temp.as_user(:a);
SELECT award_proposal(:'pid');
SELECT pg_temp.ok((SELECT dispatch_status = 'assigned' AND carrier_company_id = :'carrier' FROM freight_dispatches WHERE listing_id = :'fl'),
                  'award assigns the carrier');

SELECT pg_temp.as_user(:car);
SELECT issue_invoice(:'pid', 'INV-001') AS inv \gset
SELECT pg_temp.ok((SELECT total = 3220.00 FROM invoices WHERE id = :'inv'), 'invoice total includes 15% VAT');
SELECT pg_temp.fails(format($q$SELECT issue_invoice(%L, 'INV-002')$q$, :'pid'), 'cannot double-invoice', '%already invoiced%');
SELECT pg_temp.as_user(:a);
SELECT pg_temp.ok((SELECT status = 'pending_funding' AND amount = 3220.00 FROM escrow_transactions WHERE invoice_id = :'inv'),
                  'escrow opened for invoice total');
SELECT pg_temp.fails(format($q$SELECT escrow_transition(id, 'released') FROM escrow_transactions WHERE invoice_id = %L$q$, :'inv'),
                     'clients cannot move escrow', '%permission denied%');

SELECT pg_temp.as_user(:car);
SELECT update_dispatch(:'fl', NULL, :drv);
SELECT pg_temp.as_user(:drv);
SELECT pg_temp.ok(update_dispatch(:'fl', 'loaded') = 'loaded', 'driver marks loaded');
SELECT pg_temp.ok(update_dispatch(:'fl', 'in_transit') = 'in_transit', 'driver marks in transit');
SELECT pg_temp.fails(format($q$SELECT update_dispatch(%L, 'loaded')$q$, :'fl'), 'no backwards transitions', '%Invalid transition%');
SELECT pg_temp.fails(format($q$SELECT update_dispatch(%L, 'delivered')$q$, :'fl'), 'delivery requires ePoD', '%confirm_delivery%');
INSERT INTO attachments(company_id, storage_path, mime_type, file_name, uploaded_by)
VALUES (:'carrier', :'carrier' || '/pod.jpg', 'image/jpeg', 'pod.jpg', auth.uid()) RETURNING id AS att \gset
SELECT confirm_delivery(:'fl', :'att');
SELECT pg_temp.as_user(:a);
SELECT pg_temp.ok((SELECT count(*) = 1 FROM attachments WHERE id = :'att'), 'shipper can see the ePoD');
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.ok((SELECT array_agg(topic ORDER BY id) FROM claim_outbox_events(ARRAY['escrow.funding_requested', 'escrow.release_requested']))
                  = ARRAY['escrow.funding_requested', 'escrow.release_requested'], 'outbox queued funding + release');
SELECT escrow_transition(id, 'funded', 'EFT-IN-1') FROM escrow_transactions WHERE invoice_id = :'inv';
SELECT escrow_transition(id, 'funded', 'EFT-IN-1') FROM escrow_transactions WHERE invoice_id = :'inv';  -- webhook retry
SELECT escrow_transition(id, 'released', 'EFT-OUT-1') FROM escrow_transactions WHERE invoice_id = :'inv';
SELECT pg_temp.fails(format($q$SELECT escrow_transition(id, 'funded') FROM escrow_transactions WHERE invoice_id = %L$q$, :'inv'),
                     'released escrow cannot be re-funded', '%Invalid escrow transition%');
RESET ROLE;
SELECT pg_temp.ok((SELECT e.status = 'released' AND i.status = 'paid' FROM escrow_transactions e JOIN invoices i ON i.id = e.invoice_id
                    WHERE i.id = :'inv'), 'release marks invoice paid');

-- Auction with sealed reserve ---------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.as_user(:a);
SELECT (create_listing(:'buyer', jsonb_build_object('title', 'CAT 320 excavator', 'category', 'plant', 'listing_type', 'asset_auction',
        'reserve_price', 40000, 'bidding_closes_at', now() + interval '2 seconds'))) ->> 'id' AS al \gset
SELECT pg_temp.fails(format($q$SELECT decide_approval(id, TRUE) FROM approval_requests WHERE entity_id = %L$q$, :'al'),
                     'creator cannot approve own disposal', '%cannot approve a listing you created%');
SELECT pg_temp.as_user(:a2);
SELECT decide_approval(id, TRUE) FROM approval_requests WHERE entity_id = :'al';
SELECT pg_temp.as_user(:car);
SELECT pg_temp.ok((SELECT count(*) FROM listing_reserves) = 0, 'bidders cannot read the reserve');
INSERT INTO auction_bids(listing_id, bidder_company_id, bidder_user_id, amount) VALUES (:'al', :'carrier', auth.uid(), 35000);
SELECT pg_temp.ok(NOT auction_reserve_met(:'al'), 'reserve not yet met');
SELECT pg_temp.fails(format($q$INSERT INTO auction_bids(listing_id, bidder_company_id, bidder_user_id, amount) VALUES (%L, %L, auth.uid(), 34000)$q$, :'al', :'carrier'),
                     'bids must increase', '%must exceed%');
INSERT INTO auction_bids(listing_id, bidder_company_id, bidder_user_id, amount) VALUES (:'al', :'carrier', auth.uid(), 41000);
SELECT pg_temp.ok(auction_reserve_met(:'al'), 'reserve met');
SELECT pg_temp.as_user(:a);
SELECT pg_temp.fails(format($q$INSERT INTO auction_bids(listing_id, bidder_company_id, bidder_user_id, amount) VALUES (%L, %L, auth.uid(), 50000)$q$, :'al', :'buyer'),
                     'seller cannot bid', '%own auction%');
SELECT pg_sleep(2.2);
SELECT pg_temp.ok((close_auction(:'al') ->> 'sold')::BOOLEAN, 'auction sold above reserve');

-- Trade finance -------------------------------------------------------------------
SELECT pg_temp.as_user(:car);
INSERT INTO attachments(company_id, storage_path, mime_type, file_name, uploaded_by)
VALUES (:'carrier', :'carrier' || '/inv.pdf', 'application/pdf', 'inv.pdf', auth.uid()) RETURNING id AS ia \gset
INSERT INTO trade_finance_requests(company_id, requested_by_user_id, purchase_order_ref, debtor_company_name, invoice_amount, due_date, invoice_attachment_id)
VALUES (:'carrier', auth.uid(), 'PO-77', 'Buyer Mining', 10000, current_date + 60, :'ia') RETURNING id AS tf \gset
SELECT pg_temp.fails(format($q$SELECT review_trade_finance(%L, 'approved', NULL, 3.5)$q$, :'tf'), 'companies cannot approve their own financing', '%Platform operators only%');
SELECT pg_temp.affects_none(format($q$UPDATE trade_finance_requests SET status = 'funded' WHERE id = %L$q$, :'tf'), 'no direct status edits');
SELECT pg_temp.as_user(:ops);
SELECT pg_temp.fails(format($q$SELECT review_trade_finance(%L, 'approved')$q$, :'tf'), 'approval requires a rate', '%discount rate%');
SELECT review_trade_finance(:'tf', 'approved', 'good debtor', 3.5);
SELECT pg_temp.ok((SELECT status = 'approved' AND approved_advance = 8000.00 FROM trade_finance_requests WHERE id = :'tf'),
                  'approval computes the 80% advance');
SELECT pg_temp.fails(format($q$SELECT review_trade_finance(%L, 'settled')$q$, :'tf'), 'cannot skip funding', '%Invalid transition%');
