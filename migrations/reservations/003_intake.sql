-- No initial OPEN row: upgrading an existing deployment closes new admission
-- until the operator explicitly reviews and resumes this project.
CREATE TABLE reservation_intake (
  project_id text PRIMARY KEY CHECK(project_id ~ '^[a-f0-9]{64}$'),
  paused boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL CHECK(revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
