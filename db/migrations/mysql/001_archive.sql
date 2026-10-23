-- Statements are separated by the marker below, including compound triggers.
CREATE TABLE projects (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name LONGTEXT NOT NULL, description LONGTEXT NOT NULL,
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL,
 created_at_utc DATETIME(6) NOT NULL,
 INDEX projects_created (created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE repositories (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 project_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name LONGTEXT NOT NULL, source LONGTEXT NOT NULL,
 source_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(source,256))) STORED,
 UNIQUE KEY repositories_source (project_id,source_hash),
 FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE campaigns (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 project_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 title LONGTEXT NOT NULL, description LONGTEXT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 latest_run_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 INDEX campaigns_project (project_id,created_at,id),
 FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
 CHECK (status IN ('pending','accepted','rejected'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE runs (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 submission_id VARCHAR(200) NOT NULL UNIQUE,
 hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 report LONGTEXT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending', void_reason LONGTEXT NOT NULL,
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 INDEX runs_campaign (campaign_id,seq),
 FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
 CHECK (JSON_VALID(report)), CHECK (status IN ('pending','accepted','rejected','void'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE reviews (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 check_id LONGTEXT NOT NULL, kind VARCHAR(16) NOT NULL, body LONGTEXT NOT NULL,
 legacy BOOLEAN NOT NULL DEFAULT FALSE,
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 INDEX reviews_run (run_id,seq),
 FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
 CHECK (kind IN ('comment','accepted','rejected','pending')),
 CHECK (legacy IN (0,1))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE delivery_snapshots (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 project_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version INT UNSIGNED NOT NULL,
 request_id VARCHAR(200) NOT NULL UNIQUE,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload LONGTEXT NOT NULL,
 content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'valid',
 successor_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 UNIQUE KEY deliveries_version (campaign_id,version),
 INDEX deliveries_project (project_id,created_at,seq),
 INDEX deliveries_campaign (campaign_id,status,seq),
 INDEX deliveries_run (source_run_id,status),
 CHECK (version > 0), CHECK (JSON_VALID(payload)),
 CHECK (status IN ('valid','invalidated','revoked','superseded'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE delivery_requests (
 request_id VARCHAR(200) PRIMARY KEY,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 delivery_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 FOREIGN KEY (delivery_id) REFERENCES delivery_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE delivery_events (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 delivery_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind VARCHAR(16) NOT NULL, reason LONGTEXT NOT NULL, reference LONGTEXT NOT NULL,
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 INDEX events_delivery (delivery_id,seq),
 FOREIGN KEY (delivery_id) REFERENCES delivery_snapshots(id) ON DELETE RESTRICT,
 CHECK (kind IN ('frozen','invalidated','revoked','superseded'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE business_documents (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 delivery_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind VARCHAR(32) NOT NULL DEFAULT 'test_report',
 guide LONGTEXT NOT NULL DEFAULT (''), version INT UNSIGNED NOT NULL,
 request_id VARCHAR(200) NOT NULL UNIQUE, template_version VARCHAR(100) NOT NULL,
 status VARCHAR(16) NOT NULL, attempts INT UNSIGNED NOT NULL DEFAULT 1,
 error LONGTEXT NOT NULL DEFAULT (''),
 content_hash VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 completed_at VARCHAR(35) CHARACTER SET ascii NOT NULL DEFAULT '',
 UNIQUE KEY documents_version (delivery_id,kind,version),
 FOREIGN KEY (delivery_id) REFERENCES delivery_snapshots(id) ON DELETE RESTRICT,
 CHECK (kind IN ('test_report','business_guide')),
 CHECK (status IN ('generating','succeeded','failed')),
 CHECK (guide='' OR JSON_VALID(guide)), CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE run_moves (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_id VARCHAR(200) NOT NULL UNIQUE,
 from_campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 to_campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reason LONGTEXT NOT NULL,
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 INDEX moves_run (run_id,seq),
 FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
 CHECK (from_campaign_id<>to_campaign_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE run_consolidations (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 request_id VARCHAR(200) NOT NULL UNIQUE,
 source_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 primary_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 from_campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reason LONGTEXT NOT NULL,
 created_at VARCHAR(35) CHARACTER SET ascii NOT NULL, created_at_utc DATETIME(6) NOT NULL,
 INDEX consolidations_primary (primary_run_id),
 FOREIGN KEY (source_run_id) REFERENCES runs(id) ON DELETE CASCADE,
 FOREIGN KEY (primary_run_id) REFERENCES runs(id) ON DELETE CASCADE,
 CHECK (source_run_id<>primary_run_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TRIGGER immutable_delivery_content BEFORE UPDATE ON delivery_snapshots FOR EACH ROW
BEGIN
 IF NOT (OLD.project_id <=> NEW.project_id) OR NOT (OLD.campaign_id <=> NEW.campaign_id)
 OR NOT (OLD.source_run_id <=> NEW.source_run_id) OR NOT (OLD.version <=> NEW.version)
 OR NOT (OLD.request_id <=> NEW.request_id) OR NOT (OLD.request_hash <=> NEW.request_hash)
 OR NOT (OLD.payload <=> NEW.payload) OR NOT (OLD.content_hash <=> NEW.content_hash)
 OR NOT (OLD.created_at <=> NEW.created_at) OR NOT (OLD.created_at_utc <=> NEW.created_at_utc)
 OR NOT (OLD.seq <=> NEW.seq) OR NOT (OLD.id <=> NEW.id) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='delivery content is immutable';
 END IF;
END;
-- statement
CREATE TRIGGER preserve_delivery_archive BEFORE DELETE ON delivery_snapshots FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='delivery archive must be retained';
-- statement
CREATE TRIGGER preserve_delivery_events BEFORE UPDATE ON delivery_events FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='delivery events are immutable';
-- statement
CREATE TRIGGER preserve_delivery_event_history BEFORE DELETE ON delivery_events FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='delivery events must be retained';
-- statement
CREATE TRIGGER immutable_document BEFORE UPDATE ON business_documents FOR EACH ROW
BEGIN
 IF OLD.status='succeeded' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='successful document is immutable';
 END IF;
 IF NOT (OLD.delivery_id <=> NEW.delivery_id) OR NOT (OLD.kind <=> NEW.kind)
 OR NOT (OLD.guide <=> NEW.guide) OR NOT (OLD.version <=> NEW.version)
 OR NOT (OLD.request_id <=> NEW.request_id) OR NOT (OLD.template_version <=> NEW.template_version)
 OR NOT (OLD.created_at <=> NEW.created_at) OR NOT (OLD.created_at_utc <=> NEW.created_at_utc)
 OR NOT (OLD.id <=> NEW.id) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='document input is immutable';
 END IF;
END;
-- statement
CREATE TRIGGER immutable_run_move BEFORE UPDATE ON run_moves FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='run move is immutable';
-- statement
CREATE TRIGGER immutable_run_consolidation BEFORE UPDATE ON run_consolidations FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='run consolidation is immutable';

-- statement
CREATE TRIGGER projects_created BEFORE INSERT ON projects FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER campaigns_created BEFORE INSERT ON campaigns FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER runs_created BEFORE INSERT ON runs FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER reviews_created BEFORE INSERT ON reviews FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER delivery_snapshots_created BEFORE INSERT ON delivery_snapshots FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER delivery_events_created BEFORE INSERT ON delivery_events FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER business_documents_created BEFORE INSERT ON business_documents FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER run_moves_created BEFORE INSERT ON run_moves FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));

-- statement
CREATE TRIGGER run_consolidations_created BEFORE INSERT ON run_consolidations FOR EACH ROW
 SET NEW.created_at_utc=CAST(REPLACE(LEFT(REPLACE(NEW.created_at,'Z',''),26),'T',' ') AS DATETIME(6));
