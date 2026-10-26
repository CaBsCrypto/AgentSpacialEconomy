CREATE TABLE ads_actions(
 owner_id text NOT NULL,key text NOT NULL,action text NOT NULL,fingerprint text NOT NULL,
 state text NOT NULL CHECK(state IN ('RUNNING','DONE','FAILED')),response jsonb,failure jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,key)
);
