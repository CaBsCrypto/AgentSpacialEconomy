ALTER TABLE ads_orders ADD COLUMN design_fulfilled boolean NOT NULL DEFAULT false;
UPDATE ads_orders o SET design_fulfilled=true FROM ads_revisions r WHERE o.revision_id=r.id AND r.state='AUDITED' AND r.manifest_hash IS NOT NULL;
