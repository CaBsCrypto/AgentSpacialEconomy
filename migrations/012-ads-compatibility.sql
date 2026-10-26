CREATE TABLE ads_compatibility(
 id uuid PRIMARY KEY,owner_id text NOT NULL,payer text NOT NULL CHECK(payer ~ '^C[A-Z2-7]{55}$'),
 challenge_key text NOT NULL,challenge jsonb NOT NULL,expected jsonb NOT NULL,requirements jsonb NOT NULL,
 configuration_hash text NOT NULL CHECK(configuration_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('PENDING','VERIFYING','VERIFIED','REJECTED','RECONCILIATION_REQUIRED')),
 expires_at timestamptz NOT NULL,verify_key text,payload_hash text,signed_payload jsonb,
 auth_hash text UNIQUE,auth_nonce text,expires_ledger bigint,start_ledger bigint,
 verification_hash text,error_code text,verification_started_at timestamptz,verification_deadline timestamptz,verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,challenge_key),UNIQUE(payer,auth_nonce),
 CHECK(payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$'),
 CHECK(auth_hash IS NULL OR auth_hash ~ '^[a-f0-9]{64}$'),
 CHECK(verification_hash IS NULL OR verification_hash ~ '^[a-f0-9]{64}$'),
 CHECK((verify_key IS NULL AND payload_hash IS NULL) OR (verify_key IS NOT NULL AND payload_hash IS NOT NULL))
);
CREATE INDEX ads_compatibility_owner_created ON ads_compatibility(owner_id,created_at);
