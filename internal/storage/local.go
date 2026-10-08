package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/Chulan-824/acceptances/internal/database"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/jackc/pgx/v5"
)

type Local struct {
	Root       *os.Root
	Store      *database.Store
	LocationID string
}
type Owner struct {
	RevisionID string
	Generation int64
	Kind       string
	ID         string
	LeaseID    string
}

type Object struct {
	ID     string
	Key    string
	Size   int64
	SHA256 string
}

func Open(dir string, store *database.Store) (*Local, error) {
	dir = filepath.Join(dir, "storage")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("local storage unavailable")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("local storage unavailable")
	}
	return &Local{Root: root, Store: store, LocationID: "default-local"}, nil
}
func (l *Local) Close() { l.Root.Close() }
func (l *Local) Register(ctx context.Context) error {
	fingerprint := protocol.Digest([]byte(l.Root.Name()))
	_, err := l.Store.Pool.Exec(ctx, `INSERT INTO storage_locations(id,provider,locator_fingerprint) VALUES($1,'local',$2) ON CONFLICT(id) DO NOTHING`, l.LocationID, fingerprint)
	if err != nil {
		return err
	}
	var actual string
	if err = l.Store.Pool.QueryRow(ctx, "SELECT locator_fingerprint FROM storage_locations WHERE id=$1", l.LocationID).Scan(&actual); err != nil {
		return err
	}
	if actual != fingerprint {
		return protocol.Failure("ID_CONTENT_CONFLICT", "", "storage location cannot be rebound")
	}
	return nil
}

// Put reserves a unique DB candidate before writing and never overwrites an object.
func (l *Local) Put(ctx context.Context, project string, input io.Reader, size int64, sha string, owners ...Owner) (Object, error) {
	owner := Owner{}
	if len(owners) > 0 {
		owner = owners[0]
	}
	if reusable, ok, err := l.reuse(ctx, project, size, sha, owner); err != nil {
		return Object{}, err
	} else if ok {
		return reusable, nil
	}
	release, err := reserve(l.Root.Name(), size)
	if err != nil {
		return Object{}, err
	}
	defer release()
	o := Object{ID: protocol.NewID(), Size: size, SHA256: sha}
	o.Key = o.ID
	if _, err := l.Store.Pool.Exec(ctx, `INSERT INTO stored_objects(id,project_id,location_id,key,size,sha256,state,owner_revision_id,owner_generation,owner_kind,owner_id,owner_lease_id) VALUES($1,$2,$3,$4,$5,$6,'candidate',$7,$8,$9,$10,$11)`, o.ID, project, l.LocationID, o.Key, size, sha, nullable(owner.RevisionID), owner.Generation, owner.Kind, nullable(owner.ID), nullable(owner.LeaseID)); err != nil {
		return o, err
	}
	f, err := l.Root.OpenFile(o.Key, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return o, protocol.Failure("STORAGE_UNAVAILABLE", "", "cannot create candidate object")
	}
	n, err := io.Copy(f, io.LimitReader(contextReader{ctx: ctx, reader: input}, size+1))
	if err == nil && n != size {
		err = protocol.Failure("DIGEST_MISMATCH", "", "object length mismatch")
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return o, err
	}
	file, err := l.Root.Open(o.Key)
	if err != nil {
		return o, err
	}
	n, got, err := protocol.HashFile(file, size)
	file.Close()
	if err != nil || n != size || got != sha {
		return o, protocol.Failure("DIGEST_MISMATCH", "", "final object digest mismatch")
	}
	return o, nil
}
func (l *Local) Select(ctx context.Context, tx pgx.Tx, o Object) error {
	tag, err := tx.Exec(ctx, "UPDATE stored_objects SET state='verified' WHERE id=$1 AND state='candidate'", o.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return protocol.Failure("ID_CONTENT_CONFLICT", "", "candidate unavailable")
	}
	return nil
}
func (l *Local) Read(ctx context.Context, project, id string) (*os.File, Object, error) {
	var o Object
	var location string
	err := l.Store.Pool.QueryRow(ctx, "SELECT id::text,key,size,sha256,location_id FROM stored_objects WHERE project_id=$1 AND id=$2 AND state='verified'", project, id).Scan(&o.ID, &o.Key, &o.Size, &o.SHA256, &location)
	if err != nil {
		return nil, o, err
	}
	if location != l.LocationID {
		return nil, o, protocol.Failure("STORAGE_UNAVAILABLE", "", "historical storage location unavailable")
	}
	f, err := l.Root.Open(o.Key)
	if err != nil {
		return nil, o, protocol.Failure("STORAGE_UNAVAILABLE", "", "registered evidence unavailable")
	}
	return f, o, nil
}

// The HTTP layer also applies read deadlines so a blocked network Read terminates.
type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(b []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(b)
}

// Old crash candidates are reused only after whole-file verification and when no
// project writer holds a lease. Current candidates remain exclusive to their writer.
func (l *Local) reuse(ctx context.Context, project string, size int64, sha string, owner Owner) (Object, bool, error) {
	if owner.RevisionID == "" || owner.ID == "" {
		return Object{}, false, nil
	}
	rows, err := l.Store.Pool.Query(ctx, `SELECT id::text,key FROM stored_objects o WHERE project_id=$1 AND location_id=$2 AND size=$3 AND sha256=$4 AND state='candidate' AND created_at<now()-interval '1 hour' AND owner_revision_id=$5 AND owner_generation=$6 AND owner_kind=$7 AND owner_id=$8 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.lease_owner=o.owner_lease_id AND j.state='running' AND j.lease_until>now()) AND NOT EXISTS(SELECT 1 FROM revision_assets a WHERE a.upload_owner=o.owner_lease_id AND a.upload_deadline>now()) ORDER BY created_at LIMIT 8`, project, l.LocationID, size, sha, owner.RevisionID, owner.Generation, owner.Kind, owner.ID)
	if err != nil {
		return Object{}, false, err
	}
	candidates := []Object{}
	for rows.Next() {
		o := Object{Size: size, SHA256: sha}
		if err = rows.Scan(&o.ID, &o.Key); err != nil {
			rows.Close()
			return Object{}, false, err
		}
		candidates = append(candidates, o)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Object{}, false, err
	}
	for _, o := range candidates {
		if err = ctx.Err(); err != nil {
			return Object{}, false, err
		}
		if !protocol.ValidID(o.Key) || o.Key != o.ID {
			continue
		}
		f, err := l.Root.Open(o.Key)
		if err != nil {
			continue
		}
		n, digest, err := protocol.HashFile(f, size)
		f.Close()
		if err == nil && n == size && digest == sha {
			return o, true, nil
		}
	}
	return Object{}, false, nil
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (l *Local) CheckWritable() error {
	name := ".readiness-" + protocol.NewID()
	f, err := l.Root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return protocol.Failure("STORAGE_UNAVAILABLE", "", "local storage is not writable")
	}
	defer l.Root.Remove(name)
	err = f.Sync()
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return protocol.Failure("STORAGE_UNAVAILABLE", "", "local storage is not writable")
	}
	return nil
}
