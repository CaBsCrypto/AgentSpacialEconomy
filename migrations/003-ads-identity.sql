CREATE TABLE IF NOT EXISTS ads_identities (
  owner_id text PRIMARY KEY,
  address text NOT NULL UNIQUE,
  credential_id text NOT NULL,
  authority_hash text NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ads_auth_challenges (
  id uuid PRIMARY KEY,
  address text NOT NULL,
  credential_id text NOT NULL,
  challenge_hash text NOT NULL UNIQUE,
  authority_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_auth_challenges_wallet ON ads_auth_challenges(address, created_at);
CREATE TABLE IF NOT EXISTS ads_sessions (
  token_hash text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES ads_identities(owner_id),
  authority_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_sessions_owner ON ads_sessions(owner_id, expires_at);
