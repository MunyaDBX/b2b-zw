-- Unregistered companies, listing contact details, attachment ownership and limits.
\set a '''00000000-0000-0000-0000-0000000000f7'''
\set b '''00000000-0000-0000-0000-0000000000f8'''
INSERT INTO auth.users(id, email) VALUES (:a, 'a@one.zw'), (:b, 'b@two.zw');
SET ROLE authenticated;

SELECT pg_temp.as_user(:a);
SELECT create_company('Informal Welders', NULL, 'supplier') AS informal \gset
SELECT pg_temp.ok((SELECT registration_number ~ '^UNREG-\d{4}-[0-9A-F]{6}$' AND NOT is_registered FROM companies WHERE id = :'informal'),
                  'unregistered company gets an UNREG code');
SELECT create_company('Second Informal', '  ', 'supplier') AS informal2 \gset
SELECT pg_temp.ok((SELECT count(DISTINCT registration_number) = 2 FROM companies WHERE id IN (:'informal', :'informal2')),
                  'blank number also treated as unregistered, codes are unique');
SELECT create_company('Registered Ltd', 'cr 123/2020', 'buyer') AS reg \gset
SELECT pg_temp.ok((SELECT registration_number = 'CR 123/2020' AND is_registered FROM companies WHERE id = :'reg'),
                  'registered number kept (normalised to upper case)');
SELECT pg_temp.fails($$SELECT create_company('Dup', 'CR 123/2020', 'buyer')$$, 'duplicate registration number rejected', '%duplicate%');

-- Contacts
SELECT (create_listing(:'reg', jsonb_build_object('title', 'Steel tubing', 'category', 'metals', 'listing_type', 'rfq_procurement',
  'bidding_closes_at', now() + interval '1 day', 'contact_person', 'Tendai', 'contact_phone', '+263771234567',
  'contact_email', 'buy@reg.co.zw', 'contact_address', '12 Msasa Rd, Harare'))) ->> 'id' AS lid \gset
SELECT pg_temp.ok((SELECT contact_email = 'buy@reg.co.zw' AND contact_phone = '+263771234567' FROM b2b_listings WHERE id = :'lid'),
                  'contact details stored via create_listing');
SELECT pg_temp.fails(format($q$SELECT create_listing(%L, '{"title":"Bad","category":"x","listing_type":"rfq_procurement","bidding_closes_at":"2099-01-01","contact_email":"not-an-email"}')$q$, :'reg'),
                     'invalid contact email rejected', '%check constraint%');

-- Attachments
SELECT pg_temp.as_user(:b);
SELECT create_company('Other Co', 'R-OTHER', 'supplier') AS other \gset
SELECT pg_temp.fails(format($q$INSERT INTO attachments(company_id, listing_id, storage_path, mime_type, file_name, size_bytes, uploaded_by) VALUES (%L, %L, %L, 'image/jpeg', 'x.jpg', 1000, auth.uid())$q$, :'other', :'lid', :'other' || '/x.jpg'),
                     'cannot attach files to another company''s listing', '%row-level security%');
SELECT pg_temp.as_user(:a);
SELECT pg_temp.fails(format($q$INSERT INTO attachments(company_id, listing_id, storage_path, mime_type, file_name, size_bytes, uploaded_by) VALUES (%L, %L, %L, 'application/pdf', 'big.pdf', 20000000, auth.uid())$q$, :'reg', :'lid', :'reg' || '/big.pdf'),
                     'files over 10 MB rejected', '%attachments_size_limit%');
INSERT INTO attachments(company_id, listing_id, storage_path, mime_type, file_name, size_bytes, uploaded_by)
SELECT :'reg', :'lid', :'reg' || '/p' || g || '.jpg', 'image/jpeg', 'p.jpg', 1000, auth.uid() FROM generate_series(1, 8) g;
SELECT pg_temp.fails(format($q$INSERT INTO attachments(company_id, listing_id, storage_path, mime_type, file_name, size_bytes, uploaded_by) VALUES (%L, %L, %L, 'image/jpeg', 'p9.jpg', 1000, auth.uid())$q$, :'reg', :'lid', :'reg' || '/p9.jpg'),
                     'max 8 attachments per listing', '%at most 8%');
RESET ROLE;
