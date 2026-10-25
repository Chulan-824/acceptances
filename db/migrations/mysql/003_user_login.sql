CREATE TABLE users (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 username VARCHAR(128) NOT NULL UNIQUE,
 created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- statement
CREATE TABLE local_credentials (
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 password_hash VARBINARY(100) NOT NULL,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- statement
CREATE TABLE user_sessions (
 token_hash BINARY(32) PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 expires_at DATETIME(6) NOT NULL,
 INDEX sessions_user (user_id),
 INDEX sessions_expiry (expires_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- statement
ALTER TABLE projects ADD COLUMN created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD FOREIGN KEY (created_by) REFERENCES users(id);
-- statement
ALTER TABLE campaigns ADD COLUMN created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD FOREIGN KEY (created_by) REFERENCES users(id);
-- statement
ALTER TABLE runs ADD COLUMN created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD FOREIGN KEY (created_by) REFERENCES users(id);
-- statement
ALTER TABLE reviews ADD COLUMN created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD FOREIGN KEY (created_by) REFERENCES users(id);
