CREATE TABLE ads_fulfillment_batches(
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES ads_orders(id),sequence integer NOT NULL CHECK(sequence>=0),
 parent_batch_id uuid REFERENCES ads_fulfillment_batches(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 required_units integer NOT NULL CHECK(required_units BETWEEN 1 AND 5),delivered_units integer NOT NULL DEFAULT 0 CHECK(delivered_units>=0 AND delivered_units<=required_units),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','CLOSED','COMPLETED')),
 terms_hash text NOT NULL,terms jsonb NOT NULL,consent_id uuid REFERENCES ads_consents(id),created_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,
 UNIQUE(order_id,sequence),CHECK(ends_at>starts_at)
);
CREATE UNIQUE INDEX ads_fulfillment_one_open ON ads_fulfillment_batches(order_id) WHERE state='OPEN';
ALTER TABLE ads_orders ADD COLUMN fulfillment_version bigint NOT NULL DEFAULT 0;
ALTER TABLE ads_inventory ADD COLUMN schedule_version bigint NOT NULL DEFAULT 0;
ALTER TABLE ads_reservations ADD COLUMN batch_id uuid REFERENCES ads_fulfillment_batches(id);
ALTER TABLE ads_reservations ADD COLUMN unit_number integer CHECK(unit_number BETWEEN 1 AND 5);
ALTER TABLE ads_delivery ADD COLUMN batch_id uuid REFERENCES ads_fulfillment_batches(id);
ALTER TABLE ads_delivery ADD COLUMN unit_number integer CHECK(unit_number BETWEEN 1 AND 5);
ALTER TABLE ads_publisher_acks ADD COLUMN batch_id uuid REFERENCES ads_fulfillment_batches(id);
ALTER TABLE ads_publisher_acks ADD COLUMN unit_number integer CHECK(unit_number BETWEEN 1 AND 5);
ALTER TABLE ads_registry_jobs ADD COLUMN batch_id uuid REFERENCES ads_fulfillment_batches(id);
CREATE INDEX ads_registry_batch_sequence ON ads_registry_jobs(batch_id,sequence);
CREATE UNIQUE INDEX ads_delivery_entitlement ON ads_delivery(order_id,placement_id,unit_number) WHERE unit_number IS NOT NULL;
CREATE TABLE ads_fulfillment_units(
 order_id uuid NOT NULL REFERENCES ads_orders(id),placement_id text NOT NULL REFERENCES ads_inventory(id),number integer NOT NULL CHECK(number BETWEEN 1 AND 5),
 assigned_batch_id uuid NOT NULL REFERENCES ads_fulfillment_batches(id),completed_delivery_id uuid UNIQUE REFERENCES ads_delivery(id),completed_at timestamptz,
 PRIMARY KEY(order_id,placement_id,number),CHECK((completed_delivery_id IS NULL)=(completed_at IS NULL))
);
-- Preserve the original commitment identifier and frozen terms. Only v2 pilot orders gain entitlements.
INSERT INTO ads_fulfillment_batches(id,order_id,sequence,starts_at,ends_at,required_units,delivered_units,state,terms_hash,terms,created_at)
 SELECT o.id,o.id,0,(o.quote->>'startsAt')::timestamptz,(o.quote->>'endsAt')::timestamptz,5,
 LEAST(5,COALESCE((SELECT delivered_units FROM ads_placements p WHERE p.order_id=o.id AND p.placement_id='main_stage_screen'),0))::integer,
 CASE WHEN o.state='COMPLETED' THEN 'COMPLETED' WHEN (o.quote->>'endsAt')::timestamptz<=now() THEN 'CLOSED' ELSE 'OPEN' END,
 o.terms_hash,o.quote,o.created_at FROM ads_orders o WHERE o.quote->>'offerId'='main-stage-test-5m' AND o.quote->>'offerVersion'='2' AND o.quote->>'plan'='PASSES';
INSERT INTO ads_fulfillment_units(order_id,placement_id,number,assigned_batch_id)
 SELECT b.order_id,'main_stage_screen',n,b.id FROM ads_fulfillment_batches b CROSS JOIN generate_series(1,5) n WHERE b.sequence=0;
WITH history AS(SELECT d.id,d.order_id,row_number() OVER(PARTITION BY d.order_id,d.placement_id ORDER BY d.starts_at,d.id)::integer AS n FROM ads_delivery d JOIN ads_fulfillment_batches b ON b.id=d.order_id WHERE d.placement_id='main_stage_screen' AND d.units=1)
 UPDATE ads_delivery d SET batch_id=h.order_id,unit_number=h.n FROM history h WHERE h.id=d.id AND h.n<=5;
UPDATE ads_fulfillment_units u SET completed_delivery_id=d.id,completed_at=d.ends_at FROM ads_delivery d WHERE d.order_id=u.order_id AND d.placement_id=u.placement_id AND d.unit_number=u.number;
UPDATE ads_reservations s SET batch_id=s.order_id,unit_number=d.unit_number FROM ads_delivery d WHERE d.pass_id=s.pass_id AND d.order_id=s.order_id AND d.batch_id IS NOT NULL;
WITH pending AS(SELECT s.id,s.order_id,row_number() OVER(PARTITION BY s.order_id ORDER BY s.starts_at,s.id) AS n FROM ads_reservations s JOIN ads_fulfillment_batches b ON b.id=s.order_id WHERE s.unit_number IS NULL AND s.state IN ('HELD','COMMITTED') AND s.ends_at>now()), units AS(SELECT u.*,row_number() OVER(PARTITION BY order_id ORDER BY number) AS n FROM ads_fulfillment_units u WHERE completed_at IS NULL)
 UPDATE ads_reservations s SET batch_id=p.order_id,unit_number=u.number FROM pending p JOIN units u ON p.order_id=u.order_id AND p.n=u.n WHERE s.id=p.id;
UPDATE ads_registry_jobs j SET batch_id=j.order_id FROM ads_fulfillment_batches b WHERE b.id=j.order_id;
