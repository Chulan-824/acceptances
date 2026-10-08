-- name: GetControl :one
SELECT mode, auth_epoch, generation FROM installation_control WHERE id=1;

-- name: GetOwner :one
SELECT username, password_hash, credential_version FROM owners WHERE id=1;

-- name: LockControlShared :one
SELECT mode, auth_epoch, generation FROM installation_control WHERE id=1 FOR SHARE;
