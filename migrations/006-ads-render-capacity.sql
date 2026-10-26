ALTER TABLE ads_reservations ADD COLUMN delivery_units bigint;
UPDATE ads_reservations r SET delivery_units=CASE WHEN o.quote->>'plan'='PASSES' THEN 1 ELSE (extract(epoch FROM (r.ends_at-r.starts_at))*1000)::bigint END FROM ads_orders o WHERE o.id=r.order_id;
ALTER TABLE ads_reservations ALTER COLUMN delivery_units SET NOT NULL;
ALTER TABLE ads_reservations ADD CHECK(delivery_units>0);
