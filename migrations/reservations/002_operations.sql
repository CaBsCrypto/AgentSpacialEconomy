ALTER TABLE reservation_projects ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reservation_media DROP CONSTRAINT reservation_media_state_check;
ALTER TABLE reservation_media ADD CONSTRAINT reservation_media_state_check CHECK(state IN ('STAGED','READY','DELETING','DELETED'));
CREATE TABLE reservation_operations(id text PRIMARY KEY,project_id text NOT NULL REFERENCES reservation_projects(id),kind text NOT NULL CHECK(kind IN ('CLEANUP','RESTORE')),status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','NEEDS_RECONCILIATION')),manifest_hash text,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX reservation_media_retention ON reservation_media(project_id,created_at);
CREATE INDEX identity_challenge_expiry ON identity_challenges(expires_at);
