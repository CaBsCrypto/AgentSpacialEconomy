ALTER TABLE ads_registry_jobs DROP CONSTRAINT IF EXISTS ads_registry_jobs_operation_check;
ALTER TABLE ads_registry_jobs ADD CONSTRAINT ads_registry_jobs_operation_check CHECK(operation IN ('commit','record_delivery','complete','dispute','expire','resolve_dispute'));

ALTER TABLE ads_registry_jobs DROP CONSTRAINT IF EXISTS ads_registry_jobs_state_check;
ALTER TABLE ads_registry_jobs ADD CONSTRAINT ads_registry_jobs_state_check CHECK(state IN ('READY','SUBMITTED','CONFIRMED','RECONCILIATION_REQUIRED','CANCELLED'));
