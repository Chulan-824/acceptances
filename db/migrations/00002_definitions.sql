-- +goose Up
CREATE TABLE storage_locations (id text PRIMARY KEY, provider text NOT NULL, locator_fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stored_objects (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), location_id text NOT NULL REFERENCES storage_locations(id), key text NOT NULL,
 owner_revision_id uuid,owner_generation bigint,owner_kind text,owner_id uuid,owner_lease_id uuid,
 size bigint NOT NULL CHECK(size>=0), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), state text NOT NULL CHECK(state IN('candidate','verified','deleting')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(location_id,key), UNIQUE(project_id,id)
);
CREATE TABLE immutable_documents (
 project_id uuid NOT NULL REFERENCES projects(id), document_id uuid NOT NULL, kind text NOT NULL,
 raw_asset_id uuid NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), schema_version text NOT NULL,
 source_repository_id uuid, projection jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,document_id), FOREIGN KEY(project_id,raw_asset_id) REFERENCES stored_objects(project_id,id),
 FOREIGN KEY(project_id,source_repository_id) REFERENCES repositories(project_id,id)
);
CREATE TABLE cases (
 project_id uuid NOT NULL, id uuid NOT NULL, owner_repository_id uuid NOT NULL, origin_campaign_id uuid,
 PRIMARY KEY(project_id,id), FOREIGN KEY(project_id,owner_repository_id) REFERENCES repositories(project_id,id)
);
CREATE TABLE case_versions (
 project_id uuid NOT NULL, case_id uuid NOT NULL, version_id uuid NOT NULL, document_id uuid NOT NULL, title text NOT NULL, check_items jsonb NOT NULL,projection jsonb NOT NULL,
 PRIMARY KEY(project_id,case_id,version_id), FOREIGN KEY(project_id,case_id) REFERENCES cases(project_id,id),
 FOREIGN KEY(project_id,document_id) REFERENCES immutable_documents(project_id,document_id)
);
CREATE TABLE execution_definitions (
 project_id uuid NOT NULL, id uuid NOT NULL, case_id uuid NOT NULL, PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id,case_id) REFERENCES cases(project_id,id)
);
CREATE TABLE execution_versions (
 project_id uuid NOT NULL, execution_id uuid NOT NULL, version_id uuid NOT NULL, case_id uuid NOT NULL, case_version_id uuid NOT NULL,
 document_id uuid NOT NULL, evidence_requirements jsonb NOT NULL, projection jsonb NOT NULL,
 PRIMARY KEY(project_id,execution_id,version_id), FOREIGN KEY(project_id,execution_id) REFERENCES execution_definitions(project_id,id),
 FOREIGN KEY(project_id,case_id,case_version_id) REFERENCES case_versions(project_id,case_id,version_id),
 FOREIGN KEY(project_id,document_id) REFERENCES immutable_documents(project_id,document_id)
);
CREATE TABLE module_tags (project_id uuid NOT NULL REFERENCES projects(id),id uuid NOT NULL,name text NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE suites (project_id uuid NOT NULL REFERENCES projects(id),id uuid NOT NULL,title text NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE suite_cases (project_id uuid NOT NULL,suite_id uuid NOT NULL,case_id uuid NOT NULL,PRIMARY KEY(project_id,suite_id,case_id),FOREIGN KEY(project_id,suite_id) REFERENCES suites(project_id,id),FOREIGN KEY(project_id,case_id) REFERENCES cases(project_id,id));
CREATE TABLE suite_modules (project_id uuid NOT NULL,suite_id uuid NOT NULL,module_id uuid NOT NULL,PRIMARY KEY(project_id,suite_id,module_id),FOREIGN KEY(project_id,suite_id) REFERENCES suites(project_id,id),FOREIGN KEY(project_id,module_id) REFERENCES module_tags(project_id,id));
CREATE TABLE campaigns (
 project_id uuid NOT NULL REFERENCES projects(id),id uuid NOT NULL,title text NOT NULL,external_refs jsonb NOT NULL,
 current_plan_id uuid,current_target_id uuid,basis_version bigint NOT NULL DEFAULT 1,review_version bigint NOT NULL DEFAULT 0,current_snapshot_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,id)
);
CREATE TABLE targets (
 project_id uuid NOT NULL,id uuid NOT NULL,campaign_id uuid NOT NULL,document_id uuid NOT NULL,repositories jsonb NOT NULL,
 PRIMARY KEY(project_id,id),FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id),FOREIGN KEY(project_id,document_id) REFERENCES immutable_documents(project_id,document_id),
 UNIQUE(project_id,campaign_id,id)
);
CREATE TABLE plans (
 project_id uuid NOT NULL,id uuid NOT NULL,campaign_id uuid NOT NULL,document_id uuid NOT NULL,previous_plan_id uuid,change_reason text NOT NULL,
 PRIMARY KEY(project_id,id),FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id),FOREIGN KEY(project_id,document_id) REFERENCES immutable_documents(project_id,document_id),
 FOREIGN KEY(project_id,campaign_id,previous_plan_id) REFERENCES plans(project_id,campaign_id,id),UNIQUE(project_id,campaign_id,id)
);
CREATE TABLE plan_items (
 project_id uuid NOT NULL,plan_id uuid NOT NULL,item_id uuid NOT NULL,case_id uuid NOT NULL,case_version_id uuid NOT NULL,execution_id uuid NOT NULL,execution_version_id uuid NOT NULL,
 required boolean NOT NULL,environment jsonb NOT NULL,evidence_requirements jsonb NOT NULL,projection jsonb NOT NULL,
 PRIMARY KEY(project_id,plan_id,item_id),FOREIGN KEY(project_id,plan_id) REFERENCES plans(project_id,id),
 FOREIGN KEY(project_id,case_id,case_version_id) REFERENCES case_versions(project_id,case_id,version_id),
 FOREIGN KEY(project_id,execution_id,execution_version_id) REFERENCES execution_versions(project_id,execution_id,version_id)
);
ALTER TABLE campaigns ADD FOREIGN KEY(project_id,id,current_plan_id) REFERENCES plans(project_id,campaign_id,id);
ALTER TABLE campaigns ADD FOREIGN KEY(project_id,id,current_target_id) REFERENCES targets(project_id,campaign_id,id);
ALTER TABLE cases ADD FOREIGN KEY(project_id,origin_campaign_id) REFERENCES campaigns(project_id,id);
CREATE TABLE campaign_basis_events (id uuid PRIMARY KEY,project_id uuid NOT NULL,campaign_id uuid NOT NULL,plan_id uuid NOT NULL,target_id uuid NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(project_id,campaign_id) REFERENCES campaigns(project_id,id));
CREATE INDEX campaigns_page ON campaigns(project_id,created_at,id);
-- +goose Down
SELECT 1/0;
