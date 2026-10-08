-- +goose Up
CREATE TABLE runs (
 project_id uuid NOT NULL,id uuid NOT NULL,campaign_id uuid NOT NULL,plan_id uuid NOT NULL,target_id uuid NOT NULL,producer jsonb NOT NULL,
 source_projection jsonb,observed_projection jsonb,started_at timestamptz,ended_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id),FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id),
 FOREIGN KEY(project_id,campaign_id,plan_id) REFERENCES plans(project_id,campaign_id,id),FOREIGN KEY(project_id,campaign_id,target_id) REFERENCES targets(project_id,campaign_id,id)
);
CREATE TABLE report_revisions (
 project_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,replaces_revision_id uuid,reason text NOT NULL,
 generation bigint NOT NULL DEFAULT 1,draft_version bigint NOT NULL DEFAULT 1,phase text NOT NULL CHECK(phase IN('draft','uploading','verifying','sealed','failed','expired')),
 resume_phase text,failure_code text,retryable boolean NOT NULL DEFAULT false,auth_id uuid NOT NULL,auth_owner boolean NOT NULL,auth_epoch bigint NOT NULL,
 location_id text NOT NULL REFERENCES storage_locations(id),report_asset_id uuid NOT NULL,manifest_asset_id uuid NOT NULL,
 report_sha256 text NOT NULL,manifest_sha256 text NOT NULL,integrity_invalid boolean NOT NULL DEFAULT false,seal_digest text,sealed_at timestamptz,report jsonb NOT NULL,manifest jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,run_id,id),UNIQUE(project_id,id),
 FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id),FOREIGN KEY(project_id,report_asset_id) REFERENCES stored_objects(project_id,id),FOREIGN KEY(project_id,manifest_asset_id) REFERENCES stored_objects(project_id,id),
 FOREIGN KEY(project_id,run_id,replaces_revision_id) REFERENCES report_revisions(project_id,run_id,id)
);
CREATE TABLE revision_assets (
 project_id uuid NOT NULL,revision_id uuid NOT NULL,asset_id uuid NOT NULL,relative_path text NOT NULL,size bigint NOT NULL,sha256 text NOT NULL,
 media_type text NOT NULL,kind text NOT NULL,upload_generation bigint NOT NULL,verification_state text NOT NULL DEFAULT 'missing',selected_object_id uuid,
 upload_owner uuid,upload_deadline timestamptz,PRIMARY KEY(project_id,revision_id,asset_id),UNIQUE(project_id,revision_id,relative_path),
 FOREIGN KEY(project_id,revision_id) REFERENCES report_revisions(project_id,id),FOREIGN KEY(project_id,selected_object_id) REFERENCES stored_objects(project_id,id)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,revision_id uuid NOT NULL,generation bigint NOT NULL,kind text NOT NULL DEFAULT 'finalize',state text NOT NULL DEFAULT 'pending',
 requested_evaluation_id uuid,auth_id uuid,auth_owner boolean,auth_epoch bigint,ruleset_version text,
 lease_owner uuid,lease_until timestamptz,fence bigint NOT NULL DEFAULT 0,attempt_count integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 deadline_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',last_error text,
 UNIQUE(project_id,revision_id,generation,kind),FOREIGN KEY(project_id,revision_id) REFERENCES report_revisions(project_id,id)
);
CREATE TABLE case_results (
 project_id uuid NOT NULL,revision_id uuid NOT NULL,result_id uuid NOT NULL,run_id uuid NOT NULL,plan_item_id uuid NOT NULL,projection jsonb NOT NULL,
 PRIMARY KEY(project_id,revision_id,result_id),FOREIGN KEY(project_id,revision_id) REFERENCES report_revisions(project_id,id)
);
CREATE TABLE attempts (
 project_id uuid NOT NULL,revision_id uuid NOT NULL,result_id uuid NOT NULL,id uuid NOT NULL,ordinal bigint NOT NULL,outcome text NOT NULL,projection jsonb NOT NULL,
 PRIMARY KEY(project_id,revision_id,result_id,id),UNIQUE(project_id,revision_id,result_id,ordinal),FOREIGN KEY(project_id,revision_id,result_id) REFERENCES case_results(project_id,revision_id,result_id)
);
CREATE TABLE result_predecessors (
 project_id uuid NOT NULL,revision_id uuid NOT NULL,result_id uuid NOT NULL,previous_run_id uuid NOT NULL,previous_revision_id uuid NOT NULL,previous_result_id uuid NOT NULL,
 PRIMARY KEY(project_id,revision_id,result_id,previous_revision_id,previous_result_id),FOREIGN KEY(project_id,revision_id,result_id) REFERENCES case_results(project_id,revision_id,result_id),
 FOREIGN KEY(project_id,previous_revision_id,previous_result_id) REFERENCES case_results(project_id,revision_id,result_id)
);
CREATE TABLE evaluations (
 project_id uuid NOT NULL,id uuid NOT NULL,revision_id uuid NOT NULL,ruleset_version text NOT NULL,input_digest text NOT NULL,sha256 text NOT NULL,raw_asset_id uuid NOT NULL,
 initial boolean NOT NULL,projection jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id,revision_id) REFERENCES report_revisions(project_id,id),FOREIGN KEY(project_id,raw_asset_id) REFERENCES stored_objects(project_id,id)
);
CREATE UNIQUE INDEX revision_initial_evaluation ON evaluations(project_id,revision_id) WHERE initial;
CREATE TABLE idempotency_records (
 project_id uuid NOT NULL,operation text NOT NULL,resource_key text NOT NULL,key text NOT NULL,request_digest text NOT NULL,response_resource jsonb NOT NULL,status integer NOT NULL,
 PRIMARY KEY(project_id,operation,resource_key,key)
);
CREATE INDEX run_campaign ON runs(project_id,campaign_id,created_at,id);
CREATE INDEX revisions_run ON report_revisions(project_id,run_id);
CREATE INDEX jobs_ready ON jobs(state,next_attempt_at,lease_until);
CREATE INDEX assets_verify ON revision_assets(project_id,revision_id,verification_state);
-- +goose Down
SELECT 1/0;
