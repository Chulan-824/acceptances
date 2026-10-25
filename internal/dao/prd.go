package dao

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/Chulan-824/acceptances/internal/service"
)

type prdQueries interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type PRD struct {
	q     prdQueries
	write func(context.Context, func(*sql.Tx) error) error
}

func NewPRD(db *sql.DB, write func(context.Context, func(*sql.Tx) error) error) *PRD {
	return &PRD{q: db, write: write}
}
func (d *PRD) Transact(ctx context.Context, fn func(service.PRDStore) error) error {
	return d.write(ctx, func(tx *sql.Tx) error { return fn(&PRD{q: tx, write: d.write}) })
}

func (d *PRD) InsertConnector(ctx context.Context, v service.PRDConnector) error {
	seen, err := time.Parse(time.RFC3339Nano, v.Value.LastSeenAt)
	if err != nil {
		return err
	}
	_, err = d.q.ExecContext(ctx, "INSERT INTO lark_connectors(id,user_id,name,protocol_version,cli_version,token_hash,last_seen_at) VALUES(?,?,?,?,?,?,?)", v.Value.ID, v.UserID, v.Value.Name, v.Value.ProtocolVersion, v.Value.LarkCliVersion, v.TokenHash, seen)
	return err
}

type prdScanner interface{ Scan(...any) error }

func readPRDConnector(row prdScanner) (service.PRDConnector, error) {
	var v service.PRDConnector
	var seen time.Time
	err := row.Scan(&v.Value.ID, &v.UserID, &v.Value.Name, &v.Value.ProtocolVersion, &v.Value.LarkCliVersion, &v.TokenHash, &seen, &v.Disconnected)
	if errors.Is(err, sql.ErrNoRows) {
		return v, service.ErrPRDRecordNotFound
	}
	v.Value.LastSeenAt = seen.UTC().Format(time.RFC3339Nano)
	return v, err
}

const connectorColumns = "id,user_id,name,protocol_version,cli_version,token_hash,last_seen_at,disconnected"

func (d *PRD) GetConnector(ctx context.Context, id string) (service.PRDConnector, error) {
	return readPRDConnector(d.q.QueryRowContext(ctx, "SELECT "+connectorColumns+" FROM lark_connectors WHERE id=?", id))
}

func (d *PRD) ListConnectors(ctx context.Context, user string) ([]service.PRDConnector, error) {
	rows, err := d.q.QueryContext(ctx, "SELECT "+connectorColumns+" FROM lark_connectors WHERE user_id=? ORDER BY last_seen_at DESC,id", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []service.PRDConnector{}
	for rows.Next() {
		v, err := readPRDConnector(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

func (d *PRD) UpdateConnector(ctx context.Context, v service.PRDConnector) error {
	seen, err := time.Parse(time.RFC3339Nano, v.Value.LastSeenAt)
	if err != nil {
		return err
	}
	_, err = d.q.ExecContext(ctx, "UPDATE lark_connectors SET last_seen_at=?,disconnected=? WHERE id=?", seen, v.Disconnected, v.Value.ID)
	return err
}

func (d *PRD) CampaignExists(ctx context.Context, id string) (bool, error) {
	var found bool
	err := d.q.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM campaigns WHERE id=?)", id).Scan(&found)
	return found, err
}

const prdImportColumns = "payload,user_id,client_request_id,request_hash,claim_hash,lease_expires_at,source_hash,resource_hash,result_hash"

func readPRDImport(row prdScanner) (service.PRDImport, error) {
	var v service.PRDImport
	var payload string
	var lease sql.NullTime
	err := row.Scan(&payload, &v.UserID, &v.ClientRequestID, &v.RequestHash, &v.ClaimHash, &lease, &v.SourceHash, &v.ResourceHash, &v.ResultHash)
	if errors.Is(err, sql.ErrNoRows) {
		return v, service.ErrPRDRecordNotFound
	}
	if err != nil {
		return v, err
	}
	if err = json.Unmarshal([]byte(payload), &v.Value); err != nil {
		return v, err
	}
	if lease.Valid {
		v.LeaseExpires = lease.Time
	}
	return v, nil
}

func (d *PRD) GetImport(ctx context.Context, id string) (service.PRDImport, error) {
	return readPRDImport(d.q.QueryRowContext(ctx, "SELECT "+prdImportColumns+" FROM prd_imports WHERE id=?", id))
}

func (d *PRD) FindImport(ctx context.Context, user, campaign, request string) (service.PRDImport, error) {
	return readPRDImport(d.q.QueryRowContext(ctx, "SELECT "+prdImportColumns+" FROM prd_imports WHERE user_id=? AND campaign_id=? AND client_request_id=?", user, campaign, request))
}

func (d *PRD) InsertImport(ctx context.Context, v service.PRDImport) error {
	payload, err := json.Marshal(v.Value)
	if err != nil {
		return err
	}
	expires, err := time.Parse(time.RFC3339Nano, v.Value.ExpiresAt)
	if err != nil {
		return err
	}
	created, err := time.Parse(time.RFC3339Nano, v.Value.CreatedAt)
	if err != nil {
		return err
	}
	_, err = d.q.ExecContext(ctx, "INSERT INTO prd_imports(id,campaign_id,user_id,connector_id,client_request_id,request_hash,status,payload,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", v.Value.ID, v.Value.CampaignID, v.UserID, v.Value.ConnectorID, v.ClientRequestID, v.RequestHash, v.Value.Status, payload, expires, created)
	return err
}

func (d *PRD) UpdateImport(ctx context.Context, v service.PRDImport) error {
	payload, err := json.Marshal(v.Value)
	if err != nil {
		return err
	}
	expires, err := time.Parse(time.RFC3339Nano, v.Value.ExpiresAt)
	if err != nil {
		return err
	}
	var lease any
	if !v.LeaseExpires.IsZero() {
		lease = v.LeaseExpires
	}
	_, err = d.q.ExecContext(ctx, "UPDATE prd_imports SET payload=?,status=?,claim_hash=?,lease_expires_at=?,source_hash=?,resource_hash=?,result_hash=?,expires_at=? WHERE id=?", payload, v.Value.Status, v.ClaimHash, lease, v.SourceHash, v.ResourceHash, v.ResultHash, expires, v.Value.ID)
	return err
}

func (d *PRD) PendingImports(ctx context.Context, connector string) ([]service.PRDImport, error) {
	rows, err := d.q.QueryContext(ctx, "SELECT "+prdImportColumns+" FROM prd_imports WHERE connector_id=? AND status IN ('queued','fetching','ready') ORDER BY created_at,id", connector)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []service.PRDImport{}
	for rows.Next() {
		v, err := readPRDImport(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

func (d *PRD) CurrentSnapshot(ctx context.Context, campaign string) (string, error) {
	var key string
	err := d.q.QueryRowContext(ctx, "SELECT snapshot_id FROM campaign_prd_heads WHERE campaign_id=?", campaign).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return key, err
}

func (d *PRD) ListSnapshots(ctx context.Context, campaign string) ([]prd.Snapshot, error) {
	rows, err := d.q.QueryContext(ctx, "SELECT payload FROM prd_snapshots WHERE campaign_id=? ORDER BY created_at DESC,id", campaign)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []prd.Snapshot{}
	for rows.Next() {
		var raw string
		var v prd.Snapshot
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &v); err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

func (d *PRD) GetSnapshot(ctx context.Context, id string) (prd.Snapshot, error) {
	var raw string
	var v prd.Snapshot
	err := d.q.QueryRowContext(ctx, "SELECT payload FROM prd_snapshots WHERE id=?", id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return v, service.ErrPRDRecordNotFound
	}
	if err != nil {
		return v, err
	}
	err = json.Unmarshal([]byte(raw), &v)
	return v, err
}

func (d *PRD) InsertSnapshot(ctx context.Context, v prd.Snapshot, fingerprint string) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	created, err := time.Parse(time.RFC3339Nano, v.CreatedAt)
	if err != nil {
		return err
	}
	_, err = d.q.ExecContext(ctx, "INSERT INTO prd_snapshots(id,campaign_id,import_id,fingerprint,payload,created_at) VALUES(?,?,?,?,?,?)", v.ID, v.CampaignID, v.ImportID, fingerprint, payload, created)
	return err
}

func (d *PRD) SetCurrentSnapshot(ctx context.Context, campaign, snapshot string) error {
	_, err := d.q.ExecContext(ctx, "INSERT INTO campaign_prd_heads(campaign_id,snapshot_id) VALUES(?,?) ON DUPLICATE KEY UPDATE snapshot_id=?", campaign, snapshot, snapshot)
	return err
}

func (d *PRD) InsertFiles(ctx context.Context, id string, files []service.PRDStoredFile) error {
	for _, file := range files {
		if _, err := d.q.ExecContext(ctx, "INSERT INTO prd_import_files(import_id,filename,blob_id,modified_at) VALUES(?,?,?,?)", id, file.Name, file.BlobID, file.ModifiedAt); err != nil {
			return err
		}
	}
	return nil
}

func (d *PRD) CheckFiles(ctx context.Context, id string, files []prd.File) error {
	rows, err := d.q.QueryContext(ctx, "SELECT f.filename,b.size_bytes,HEX(b.sha256) FROM prd_import_files f JOIN archive_blobs b ON b.id=f.blob_id AND b.state='ready' WHERE f.import_id=?", id)
	if err != nil {
		return err
	}
	defer rows.Close()
	expected := map[string]prd.File{}
	for _, f := range files {
		expected[f.Name] = f
	}
	for rows.Next() {
		var name, hash string
		var size int64
		if err = rows.Scan(&name, &size, &hash); err != nil {
			return err
		}
		v, ok := expected[name]
		if !ok || v.Size != size || !strings.EqualFold(v.SHA256, hash) {
			return fmt.Errorf("PRD file integrity mismatch")
		}
		delete(expected, name)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	if len(expected) > 0 {
		return fmt.Errorf("PRD files are missing")
	}
	return nil
}

func (d *PRD) ClearCandidateFiles(ctx context.Context, id string) error {
	_, err := d.q.ExecContext(ctx, "DELETE FROM prd_import_files WHERE import_id=? AND NOT EXISTS(SELECT 1 FROM prd_snapshots WHERE import_id=?)", id, id)
	return err
}
