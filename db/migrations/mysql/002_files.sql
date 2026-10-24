-- File contents and their independent business references.
CREATE TABLE archive_blobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  state VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'staging',
  sha256 BINARY(32) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
  chunk_size INT UNSIGNED NOT NULL DEFAULT 1048576,
  write_token BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  touched_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  sealed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY archive_blobs_sha256 (sha256),
  INDEX archive_blobs_recovery (state, touched_at),
  CONSTRAINT archive_blobs_chunk_size CHECK (chunk_size = 1048576),
  CONSTRAINT archive_blobs_state CHECK (
    (state = 'staging' AND sha256 IS NULL AND sealed_at IS NULL)
    OR
    (state = 'ready' AND sha256 IS NOT NULL AND sealed_at IS NOT NULL
      AND chunk_count = (size_bytes + 1048575) DIV 1048576)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE archive_blob_chunks (
  blob_id BIGINT UNSIGNED NOT NULL,
  chunk_no INT UNSIGNED NOT NULL,
  content MEDIUMBLOB NOT NULL,
  chunk_sha256 BINARY(32) NOT NULL,
  PRIMARY KEY (blob_id, chunk_no),
  CONSTRAINT archive_blob_chunks_blob FOREIGN KEY (blob_id)
    REFERENCES archive_blobs(id) ON DELETE CASCADE,
  CONSTRAINT archive_blob_chunks_length CHECK (
    OCTET_LENGTH(content) BETWEEN 1 AND 1048576
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE run_files (
  run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  filename VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  blob_id BIGINT UNSIGNED NOT NULL,
  modified_at DATETIME(6) NOT NULL,
  PRIMARY KEY (run_id, filename),
  INDEX run_files_blob (blob_id),
  CONSTRAINT run_files_run FOREIGN KEY (run_id)
    REFERENCES runs(id) ON DELETE CASCADE,
  CONSTRAINT run_files_content FOREIGN KEY (blob_id)
    REFERENCES archive_blobs(id) ON DELETE RESTRICT,
  CONSTRAINT run_files_name CHECK (
    OCTET_LENGTH(filename) BETWEEN 1 AND 200
    AND filename NOT IN ('.', '..')
    AND INSTR(filename, '/') = 0 AND INSTR(filename, CHAR(92)) = 0
    AND INSTR(filename, CHAR(0)) = 0
    AND INSTR(filename, CHAR(10)) = 0 AND INSTR(filename, CHAR(13)) = 0
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE delivery_files (
  delivery_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  filename VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  blob_id BIGINT UNSIGNED NOT NULL,
  modified_at DATETIME(6) NOT NULL,
  PRIMARY KEY (delivery_id, filename),
  INDEX delivery_files_blob (blob_id),
  CONSTRAINT delivery_files_delivery FOREIGN KEY (delivery_id)
    REFERENCES delivery_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT delivery_files_content FOREIGN KEY (blob_id)
    REFERENCES archive_blobs(id) ON DELETE RESTRICT,
  CONSTRAINT delivery_files_name CHECK (
    OCTET_LENGTH(filename) BETWEEN 1 AND 200
    AND filename NOT IN ('.', '..')
    AND INSTR(filename, '/') = 0 AND INSTR(filename, CHAR(92)) = 0
    AND INSTR(filename, CHAR(0)) = 0
    AND INSTR(filename, CHAR(10)) = 0 AND INSTR(filename, CHAR(13)) = 0
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE document_files (
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blob_id BIGINT UNSIGNED NOT NULL,
  modified_at DATETIME(6) NOT NULL,
  PRIMARY KEY (document_id),
  INDEX document_files_blob (blob_id),
  CONSTRAINT document_files_document FOREIGN KEY (document_id)
    REFERENCES business_documents(id) ON DELETE RESTRICT,
  CONSTRAINT document_files_content FOREIGN KEY (blob_id)
    REFERENCES archive_blobs(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE archive_file_imports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  archive_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_directory LONGTEXT NOT NULL,
  backup_directory LONGTEXT NOT NULL,
  source_manifest_sha256 BINARY(32) NOT NULL,
  source_manifest LONGTEXT NOT NULL,
  status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_files INT UNSIGNED NOT NULL,
  source_bytes BIGINT UNSIGNED NOT NULL,
  verified_files INT UNSIGNED NOT NULL DEFAULT 0,
  verified_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  error LONGTEXT NOT NULL DEFAULT (''),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  verified_at DATETIME(6) NULL,
  activated_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY archive_file_imports_source (archive_id, source_manifest_sha256),
  CONSTRAINT archive_file_imports_manifest CHECK (JSON_VALID(source_manifest)),
  CONSTRAINT archive_file_imports_status CHECK (
    status IN ('planned', 'importing', 'verifying', 'verified', 'activated', 'failed')
  ),
  CONSTRAINT archive_file_imports_counts CHECK (
    verified_files <= source_files AND verified_bytes <= source_bytes
  ),
  CONSTRAINT archive_file_imports_verified CHECK (
    status NOT IN ('verified', 'activated')
    OR (verified_at IS NOT NULL AND verified_files = source_files
      AND verified_bytes = source_bytes)
  ),
  CONSTRAINT archive_file_imports_activated CHECK (
    (status = 'activated' AND activated_at IS NOT NULL)
    OR (status <> 'activated' AND activated_at IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE archive_file_storage (
  singleton TINYINT UNSIGNED NOT NULL,
  backend VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (singleton),
  CONSTRAINT archive_file_storage_singleton CHECK (singleton = 1),
  CONSTRAINT archive_file_storage_backend CHECK (backend IN ('filesystem', 'mysql')),
  CONSTRAINT archive_file_storage_mode CHECK (
    backend = 'mysql' OR active_import_id IS NULL
  ),
  CONSTRAINT archive_file_storage_import FOREIGN KEY (active_import_id)
    REFERENCES archive_file_imports(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
-- Upgrade default preserves the current backend until verified activation.
-- A brand-new empty archive can explicitly bootstrap to mysql in the module.
INSERT INTO archive_file_storage(singleton, backend) VALUES (1, 'filesystem');
-- statement
CREATE TRIGGER archive_blob_seal BEFORE UPDATE ON archive_blobs FOR EACH ROW
BEGIN
 DECLARE n BIGINT; DECLARE total BIGINT; DECLARE first_no BIGINT; DECLARE last_no BIGINT;
 IF OLD.state='ready' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='sealed file content is immutable';
 END IF;
 IF NEW.state='ready' THEN
  SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(content)),0),COALESCE(MIN(chunk_no),0),COALESCE(MAX(chunk_no),0)
   INTO n,total,first_no,last_no FROM archive_blob_chunks WHERE blob_id=OLD.id;
  IF n<>NEW.chunk_count OR total<>NEW.size_bytes OR (n>0 AND (first_no<>0 OR last_no<>n-1)) THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='file chunks are incomplete';
  END IF;
 END IF;
END;
-- statement
CREATE TRIGGER archive_chunk_insert BEFORE INSERT ON archive_blob_chunks FOR EACH ROW
BEGIN
 DECLARE parent_state VARCHAR(8);
 SELECT state INTO parent_state FROM archive_blobs WHERE id=NEW.blob_id FOR SHARE;
 IF parent_state<>'staging' OR NOT (NEW.chunk_sha256 <=> UNHEX(SHA2(NEW.content,256))) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='file chunk is sealed or corrupt';
 END IF;
END;
-- statement
CREATE TRIGGER archive_chunk_update BEFORE UPDATE ON archive_blob_chunks FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='file chunks are immutable';
-- statement
CREATE TRIGGER archive_chunk_delete BEFORE DELETE ON archive_blob_chunks FOR EACH ROW
BEGIN
 IF EXISTS(SELECT 1 FROM archive_blobs WHERE id=OLD.blob_id AND state='ready') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='sealed chunks must be collected with their unreferenced object';
 END IF;
END;
-- statement
CREATE TRIGGER run_file_insert BEFORE INSERT ON run_files FOR EACH ROW
BEGIN
 IF NOT EXISTS(SELECT 1 FROM archive_blobs WHERE id=NEW.blob_id AND state='ready')
 OR NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id
  AND JSON_CONTAINS(JSON_EXTRACT(report,'$.evidence'),JSON_OBJECT('path',NEW.filename))) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='run file is undeclared or incomplete';
 END IF;
END;
-- statement
CREATE TRIGGER run_file_update BEFORE UPDATE ON run_files FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='run files are immutable';
-- statement
CREATE TRIGGER run_file_delete BEFORE DELETE ON run_files FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='run files are removed only by deleting their Run';
-- statement
CREATE TRIGGER delivery_file_insert BEFORE INSERT ON delivery_files FOR EACH ROW
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM delivery_snapshots d
  JOIN JSON_TABLE(d.payload,'$.files[*]' COLUMNS(
   name VARCHAR(200) PATH '$.path',sha CHAR(64) PATH '$.sha256',size BIGINT PATH '$.size'
  )) f
  JOIN archive_blobs b ON b.id=NEW.blob_id AND b.state='ready'
  WHERE d.id=NEW.delivery_id AND f.name COLLATE utf8mb4_0900_bin=NEW.filename
   AND b.sha256=UNHEX(f.sha) AND b.size_bytes=f.size
 ) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='delivery file differs from frozen content';
 END IF;
END;
-- statement
CREATE TRIGGER delivery_file_update BEFORE UPDATE ON delivery_files FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='frozen file references are immutable';
-- statement
CREATE TRIGGER delivery_file_delete BEFORE DELETE ON delivery_files FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='frozen file references must be retained';
-- statement
CREATE TRIGGER document_file_insert BEFORE INSERT ON document_files FOR EACH ROW
BEGIN
 IF NOT EXISTS(SELECT 1 FROM business_documents d JOIN archive_blobs b ON b.id=NEW.blob_id
  WHERE d.id=NEW.document_id AND b.state='ready'
   AND (d.status='generating' OR (d.status='succeeded' AND b.sha256=UNHEX(d.content_hash)))) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='document content is incomplete or differs';
 END IF;
END;
-- statement
CREATE TRIGGER document_file_update BEFORE UPDATE ON document_files FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='document file references are immutable';
-- statement
CREATE TRIGGER document_file_delete BEFORE DELETE ON document_files FOR EACH ROW
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='document file references must be retained';
-- statement
CREATE TRIGGER document_file_success BEFORE UPDATE ON business_documents FOR EACH ROW
BEGIN
 IF NEW.status='succeeded' AND EXISTS(SELECT 1 FROM archive_file_storage WHERE singleton=1 AND backend='mysql')
 AND NOT EXISTS(SELECT 1 FROM document_files f JOIN archive_blobs b ON b.id=f.blob_id
  WHERE f.document_id=NEW.id AND b.state='ready' AND b.sha256=UNHEX(NEW.content_hash)) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='successful document requires complete file content';
 END IF;
END;
-- statement
CREATE TRIGGER archive_file_activation BEFORE UPDATE ON archive_file_storage FOR EACH ROW
BEGIN
 IF OLD.backend='mysql' AND NEW.backend<>'mysql' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='file backend cannot silently roll back';
 END IF;
 IF NEW.active_import_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM archive_file_imports i JOIN schema_migrations m ON m.version=1 AND m.archive_id=i.archive_id
  WHERE i.id=NEW.active_import_id AND i.status='activated'
 ) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='file import is not verified and activated';
 END IF;
END;
