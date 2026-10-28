CREATE TABLE run_supplements (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL UNIQUE,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload LONGTEXT NOT NULL,
 INDEX supplements_run (run_id,seq),
 FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
 CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TRIGGER run_supplements_immutable BEFORE UPDATE ON run_supplements FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='run supplements are append only';
END;
-- statement
DROP TRIGGER run_file_insert;
-- statement
CREATE TRIGGER run_file_insert BEFORE INSERT ON run_files FOR EACH ROW
BEGIN
 IF NOT EXISTS(SELECT 1 FROM archive_blobs WHERE id=NEW.blob_id AND state='ready')
 OR NOT (
  EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id
   AND JSON_CONTAINS(JSON_EXTRACT(report,'$.evidence'),JSON_OBJECT('path',NEW.filename)))
  OR EXISTS(
   SELECT 1 FROM run_supplements s
   JOIN JSON_TABLE(s.payload,'$.files[*]' COLUMNS(
    name VARCHAR(200) PATH '$.path',sha CHAR(64) PATH '$.sha256',size BIGINT PATH '$.size'
   )) f
   JOIN archive_blobs b ON b.id=NEW.blob_id AND b.state='ready'
   WHERE s.run_id=NEW.run_id AND f.name COLLATE utf8mb4_0900_bin=NEW.filename
    AND b.sha256=UNHEX(f.sha) AND b.size_bytes=f.size
    AND JSON_CONTAINS(JSON_EXTRACT(s.payload,'$.evidence'),JSON_OBJECT('path',NEW.filename))
  )
 ) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='run file is undeclared or incomplete';
 END IF;
END;
