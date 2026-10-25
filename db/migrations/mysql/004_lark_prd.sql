CREATE TABLE lark_connectors (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(200) NOT NULL,
 protocol_version INT UNSIGNED NOT NULL,
 cli_version VARCHAR(100) NOT NULL,
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 last_seen_at DATETIME(6) NOT NULL,
 disconnected BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE KEY lark_connector_owner (id,user_id),
 INDEX lark_connectors_user (user_id),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE prd_imports (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 connector_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 client_request_id VARCHAR(200) NOT NULL,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload LONGTEXT NOT NULL,
 claim_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 lease_expires_at DATETIME(6) NULL,
 source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 resource_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 result_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 expires_at DATETIME(6) NOT NULL,
 created_at DATETIME(6) NOT NULL,
 UNIQUE KEY prd_import_request (user_id,campaign_id,client_request_id),
 UNIQUE KEY prd_import_campaign (campaign_id,id),
 INDEX prd_import_pending (connector_id,status,created_at),
 FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
 FOREIGN KEY (connector_id,user_id) REFERENCES lark_connectors(id,user_id),
 CHECK (JSON_VALID(payload)),
 CHECK (status IN ('queued','fetching','ready','confirmed','failed','cancelled','expired')),
 CHECK (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.id'))=id AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.campaignId'))=campaign_id
  AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.status'))=status
  AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.connectorId'))=connector_id
  AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.createdBy.id'))=user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE prd_import_files (
 import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 filename VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
 blob_id BIGINT UNSIGNED NOT NULL,
 modified_at DATETIME(6) NOT NULL,
 PRIMARY KEY(import_id,filename),
 INDEX prd_file_blob(blob_id),
 FOREIGN KEY(import_id) REFERENCES prd_imports(id) ON DELETE CASCADE,
 FOREIGN KEY(blob_id) REFERENCES archive_blobs(id) ON DELETE RESTRICT,
 CHECK (OCTET_LENGTH(filename) BETWEEN 1 AND 200 AND filename NOT IN ('.','..')
  AND INSTR(filename,'/')=0 AND INSTR(filename,CHAR(92))=0 AND INSTR(filename,CHAR(0))=0
  AND INSTR(filename,CHAR(10))=0 AND INSTR(filename,CHAR(13))=0 AND INSTR(filename,':')=0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE prd_snapshots (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload LONGTEXT NOT NULL,
 created_at DATETIME(6) NOT NULL,
 UNIQUE KEY prd_snapshot_import(import_id),
 UNIQUE KEY prd_snapshot_fingerprint(campaign_id,fingerprint),
 UNIQUE KEY prd_snapshot_campaign(campaign_id,id),
 FOREIGN KEY(campaign_id,import_id) REFERENCES prd_imports(campaign_id,id) ON DELETE CASCADE,
 CHECK(JSON_VALID(payload)),
 CHECK(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.id'))=id AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.campaignId'))=campaign_id
  AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.importId'))=import_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE campaign_prd_heads (
 campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 snapshot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
 FOREIGN KEY(campaign_id,snapshot_id) REFERENCES prd_snapshots(campaign_id,id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- statement
CREATE TRIGGER prd_file_insert BEFORE INSERT ON prd_import_files FOR EACH ROW
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM prd_imports i
  JOIN JSON_TABLE(i.payload,'$.manifest.files[*]' COLUMNS(
   name VARCHAR(200) PATH '$.name',sha CHAR(64) PATH '$.sha256',size BIGINT PATH '$.size'
  )) f
  JOIN archive_blobs b ON b.id=NEW.blob_id AND b.state='ready'
  WHERE i.id=NEW.import_id AND i.status='ready'
   AND f.name COLLATE utf8mb4_0900_bin=NEW.filename AND b.sha256=UNHEX(f.sha) AND b.size_bytes=f.size
 ) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD file is undeclared or incomplete';
 END IF;
END;
-- statement
CREATE TRIGGER prd_file_update BEFORE UPDATE ON prd_import_files FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD files are immutable';
-- statement
CREATE TRIGGER prd_file_delete BEFORE DELETE ON prd_import_files FOR EACH ROW
BEGIN
 IF EXISTS(SELECT 1 FROM prd_snapshots WHERE import_id=OLD.import_id) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='confirmed PRD files are retained with their Campaign';
 END IF;
END;
-- statement
CREATE TRIGGER prd_snapshot_insert BEFORE INSERT ON prd_snapshots FOR EACH ROW
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM prd_imports i WHERE i.id=NEW.import_id AND i.campaign_id=NEW.campaign_id AND i.status='ready'
   AND JSON_EXTRACT(i.payload,'$.manifest')=JSON_EXTRACT(NEW.payload,'$.manifest')
   AND JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.sourceHash'))=i.source_hash
   AND JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.resourceHash'))=i.resource_hash
   AND JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.sourceUrl'))=JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.url'))
   AND JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.createdBy.id'))=i.user_id
   AND JSON_LENGTH(JSON_EXTRACT(i.payload,'$.manifest.files'))=(SELECT COUNT(*) FROM prd_import_files WHERE import_id=i.id)
 ) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD snapshot differs from its sealed import';
 END IF;
END;
-- statement
CREATE TRIGGER prd_snapshot_update BEFORE UPDATE ON prd_snapshots FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD snapshots are immutable';
-- statement
CREATE TRIGGER prd_snapshot_delete BEFORE DELETE ON prd_snapshots FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD snapshots are removed only with their Campaign';
-- statement
CREATE TRIGGER prd_import_update BEFORE UPDATE ON prd_imports FOR EACH ROW
BEGIN
 IF NEW.id<>OLD.id OR NEW.campaign_id<>OLD.campaign_id OR NEW.user_id<>OLD.user_id OR NEW.connector_id<>OLD.connector_id
  OR NEW.client_request_id<>OLD.client_request_id OR NEW.request_hash<>OLD.request_hash
  OR NOT(JSON_EXTRACT(NEW.payload,'$.url') <=> JSON_EXTRACT(OLD.payload,'$.url')) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD task ownership and source are immutable';
 END IF;
 IF OLD.status='confirmed' AND (NEW.status<>'confirmed'
  OR NOT(JSON_EXTRACT(NEW.payload,'$.confirmedSnapshotId') <=> JSON_EXTRACT(OLD.payload,'$.confirmedSnapshotId'))) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD confirmation is immutable';
 END IF;
 IF OLD.status IN ('ready','confirmed') AND (
  NOT(JSON_EXTRACT(NEW.payload,'$.manifest') <=> JSON_EXTRACT(OLD.payload,'$.manifest'))
  OR NEW.source_hash<>OLD.source_hash OR NEW.resource_hash<>OLD.resource_hash OR NEW.result_hash<>OLD.result_hash
 ) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='sealed PRD import content is immutable';
 END IF;
 IF NEW.status='confirmed' AND NOT EXISTS(
  SELECT 1 FROM prd_snapshots WHERE campaign_id=NEW.campaign_id AND id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.confirmedSnapshotId'))
 ) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRD confirmation points to another Campaign';
 END IF;
END;
-- statement
CREATE TRIGGER prd_import_delete BEFORE DELETE ON prd_imports FOR EACH ROW
BEGIN
 IF EXISTS(SELECT 1 FROM prd_snapshots WHERE import_id=OLD.id) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='confirmed PRD imports are retained with their Campaign';
 END IF;
END;
