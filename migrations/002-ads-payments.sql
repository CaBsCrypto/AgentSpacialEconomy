CREATE TABLE IF NOT EXISTS ads_payment_attempts (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES ads_orders(id), idempotency_key text NOT NULL,
 payload_hash text NOT NULL, signed_payload jsonb NOT NULL, network text NOT NULL CHECK(network='stellar:testnet'),
 payer text NOT NULL, auth_nonce text NOT NULL, auth_hash text NOT NULL UNIQUE,
 expires_ledger bigint NOT NULL, start_ledger bigint NOT NULL,
 state text NOT NULL CHECK(state IN ('VERIFYING','SETTLING','SETTLED','FAILED','RECONCILIATION_REQUIRED')),
 settlement_tx text UNIQUE, verification jsonb, settlement jsonb, evidence jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,idempotency_key), UNIQUE(network,payer,auth_nonce)
);
CREATE UNIQUE INDEX IF NOT EXISTS ads_payment_one_active_order ON ads_payment_attempts(order_id)
 WHERE state IN ('VERIFYING','SETTLING','SETTLED','RECONCILIATION_REQUIRED');
CREATE TABLE IF NOT EXISTS ads_refunds (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES ads_orders(id), idempotency_key text NOT NULL,
 requested_by text NOT NULL, amount numeric(39,0) NOT NULL CHECK(amount>0), reason text NOT NULL,
 state text NOT NULL CHECK(state IN ('REQUESTED','APPROVED','SUBMITTED','CONFIRMED','RECONCILIATION_REQUIRED','REJECTED')),
 approved_by text, remedy jsonb, signed_xdr text, transaction_hash text UNIQUE, evidence jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(order_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS ads_registry_jobs (
 sequence bigserial UNIQUE, id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES ads_orders(id),
 operation text NOT NULL CHECK(operation IN ('commit','record_delivery','complete','dispute','expire','resolve_dispute')),
 payload jsonb NOT NULL, payload_hash text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','SUBMITTED','CONFIRMED','RECONCILIATION_REQUIRED','CANCELLED')),
 transaction_hash text, evidence jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ads_registry_jobs ADD COLUMN IF NOT EXISTS signed_xdr text;
