-- +goose Up
CREATE TABLE campaign_selections (
 project_id uuid NOT NULL,id uuid NOT NULL,campaign_id uuid NOT NULL,plan_item_id uuid NOT NULL,result_ref jsonb NOT NULL,candidate_digest text NOT NULL,reason text NOT NULL,
 actor_owner_id smallint NOT NULL REFERENCES owners(id),basis_version bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id),FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id)
);
CREATE TABLE evaluation_adoptions (
 project_id uuid NOT NULL,id uuid NOT NULL,campaign_id uuid NOT NULL,evaluation_id uuid NOT NULL,reason text NOT NULL,basis_version bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id),FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id),FOREIGN KEY(project_id,evaluation_id) REFERENCES evaluations(project_id,id)
);
CREATE TABLE acceptance_snapshots (
 project_id uuid NOT NULL,id uuid NOT NULL,campaign_id uuid NOT NULL,basis_version bigint NOT NULL,sha256 text NOT NULL,raw_asset_id uuid NOT NULL,plan_id uuid NOT NULL,target_id uuid NOT NULL,
 readiness text NOT NULL,projection jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,id),UNIQUE(project_id,campaign_id,sha256),
 FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id),FOREIGN KEY(project_id,raw_asset_id) REFERENCES stored_objects(project_id,id),
 FOREIGN KEY(project_id,campaign_id,plan_id) REFERENCES plans(project_id,campaign_id,id),FOREIGN KEY(project_id,campaign_id,target_id) REFERENCES targets(project_id,campaign_id,id)
);
CREATE TABLE snapshot_items (
 project_id uuid NOT NULL,snapshot_id uuid NOT NULL,plan_item_id uuid NOT NULL,result_ref jsonb,evaluation_ref jsonb,eligibility boolean NOT NULL,diagnostics jsonb NOT NULL,
 PRIMARY KEY(project_id,snapshot_id,plan_item_id),FOREIGN KEY(project_id,snapshot_id) REFERENCES acceptance_snapshots(project_id,id)
);
CREATE TABLE review_events (
 project_id uuid NOT NULL,id uuid NOT NULL,campaign_id uuid NOT NULL,snapshot_id uuid NOT NULL,seq bigint NOT NULL,actor_owner_id smallint NOT NULL REFERENCES owners(id),
 action text NOT NULL CHECK(action IN('comment','reject_item','resolve_rejection','accept','reject','accept_risk','withdraw')),item_id uuid,reason text,
 risk_items jsonb NOT NULL DEFAULT '[]',resolves_event_ids uuid[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id),UNIQUE(project_id,campaign_id,seq),FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id),
 FOREIGN KEY(project_id,snapshot_id) REFERENCES acceptance_snapshots(project_id,id)
);
ALTER TABLE campaigns ADD FOREIGN KEY(project_id,current_snapshot_id) REFERENCES acceptance_snapshots(project_id,id);
CREATE INDEX results_plan_item ON case_results(project_id,revision_id,plan_item_id);
CREATE INDEX reviews_page ON review_events(project_id,campaign_id,seq);
-- +goose Down
SELECT 1/0;
