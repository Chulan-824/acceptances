-- +goose Up
CREATE TABLE installation_control (
 id smallint PRIMARY KEY CHECK (id=1), mode text NOT NULL DEFAULT 'normal' CHECK(mode IN ('normal','draining','maintenance')),
 generation bigint NOT NULL DEFAULT 1, auth_epoch bigint NOT NULL DEFAULT 1,
 maintenance_started_at timestamptz
);
INSERT INTO installation_control(id) VALUES(1);
CREATE TABLE owners (
 id smallint PRIMARY KEY CHECK(id=1), username text NOT NULL UNIQUE CHECK(length(username) BETWEEN 1 AND 128),
 password_hash text NOT NULL, credential_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 256), version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE repositories (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT, id uuid NOT NULL,
 display_name text NOT NULL, locator text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id)
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, owner_id smallint NOT NULL REFERENCES owners(id), secret_hash text NOT NULL, csrf_hash text NOT NULL,
 auth_epoch bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_interaction_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE api_tokens (
 id uuid PRIMARY KEY, owner_id smallint NOT NULL REFERENCES owners(id), project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL, secret_hash text NOT NULL, scopes text[] NOT NULL, expires_at timestamptz, revoked_at timestamptz,
 auth_epoch bigint NOT NULL, version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id)
);
CREATE TABLE admin_events (
 id uuid PRIMARY KEY, action text NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- +goose Down
-- Downgrades are deliberately unsupported; restore an isolated verified backup instead.
SELECT 1/0;
