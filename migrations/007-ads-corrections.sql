ALTER TABLE ads_generation_attempts ADD COLUMN revision_id uuid REFERENCES ads_revisions(id);
UPDATE ads_generation_attempts g SET revision_id=o.revision_id FROM ads_orders o WHERE g.order_id=o.id;
ALTER TABLE ads_generation_attempts ALTER COLUMN revision_id SET NOT NULL;
ALTER TABLE ads_generation_attempts DROP CONSTRAINT ads_generation_attempts_pkey;
ALTER TABLE ads_generation_attempts ADD PRIMARY KEY(order_id,revision_id);
CREATE TABLE ads_order_corrections(order_id uuid NOT NULL REFERENCES ads_orders(id),revision_id uuid NOT NULL REFERENCES ads_revisions(id),previous_revision uuid NOT NULL REFERENCES ads_revisions(id),owner_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(order_id,revision_id));
