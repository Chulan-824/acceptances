package api

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

const archiveChunkSize = 1 << 20

type fileOwner struct{ kind, id string }

func (o fileOwner) relation() (table, column string, err error) {
	switch o.kind {
	case "evidence":
		return "run_files", "run_id", nil
	case "deliveries":
		return "delivery_files", "delivery_id", nil
	case "documents":
		return "document_files", "document_id", nil
	default:
		return "", "", fmt.Errorf("unknown file owner %q", o.kind)
	}
}

func (o fileOwner) directory(dir string) string {
	if o.kind == "deliveries" {
		return filepath.Join(dir, o.kind, o.id, "evidence")
	}
	return filepath.Join(dir, o.kind, o.id)
}

type fileArchive struct{ mysql bool }

func (s *Server) databaseFiles() bool { return s.files != nil && s.files.mysql }

type archiveFileSet struct {
	fs.FS
	close func() error
}
type readSeekFile interface {
	fs.File
	io.Seeker
}

func (f *archiveFileSet) Close() error {
	if f.close != nil {
		return f.close()
	}
	return nil
}

func legacyFileSet(dir string, owner fileOwner) (*archiveFileSet, error) {
	root, err := os.OpenRoot(owner.directory(dir))
	if err != nil {
		return nil, err
	}
	return &archiveFileSet{FS: root.FS(), close: root.Close}, nil
}

func (s *Server) openFiles(ctx context.Context, owner fileOwner) (*archiveFileSet, error) {
	if !s.databaseFiles() {
		return legacyFileSet(s.dir, owner)
	}
	if _, _, err := owner.relation(); err != nil {
		return nil, err
	}
	return &archiveFileSet{FS: &databaseFileSet{s: s, ctx: ctx, owner: owner}}, nil
}

type databaseFileSet struct {
	s     *Server
	ctx   context.Context
	owner fileOwner
}

func (f *databaseFileSet) Open(name string) (fs.File, error) {
	if !validName(name) || f.owner.kind == "documents" && name != "business.html" {
		return nil, fs.ErrNotExist
	}
	table, column, err := f.owner.relation()
	if err != nil {
		return nil, err
	}
	tx, err := f.s.db.BeginTx(f.ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	r := &blobReader{ctx: f.ctx, tx: tx, cachedNo: -1}
	query := "SELECT b.id,b.size_bytes,b.sha256,f.modified_at FROM " + table + " f JOIN archive_blobs b ON b.id=f.blob_id WHERE f." + column + "=? AND b.state='ready'"
	args := []any{f.owner.id}
	if f.owner.kind != "documents" {
		query += " AND f.filename=?"
		args = append(args, name)
	}
	var hash []byte
	err = tx.QueryRowContext(f.ctx, query, args...).Scan(&r.blobID, &r.info.size, &hash, &r.info.modified)
	if err != nil {
		tx.Rollback()
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fs.ErrNotExist
		}
		return nil, err
	}
	r.info.name = name
	r.sha256 = hex.EncodeToString(hash)
	return r, nil
}

type storedFileInfo struct {
	name     string
	size     int64
	modified time.Time
}

func (i storedFileInfo) Name() string       { return i.name }
func (i storedFileInfo) Size() int64        { return i.size }
func (i storedFileInfo) Mode() fs.FileMode  { return 0600 }
func (i storedFileInfo) ModTime() time.Time { return i.modified }
func (i storedFileInfo) IsDir() bool        { return false }
func (i storedFileInfo) Sys() any           { return nil }

// Every reader holds one MVCC snapshot, including metadata and chunks. Deleting
// a Run during a download cannot turn its later chunk reads into missing rows.
type blobReader struct {
	ctx      context.Context
	tx       *sql.Tx
	blobID   uint64
	info     storedFileInfo
	sha256   string
	position int64
	cachedNo int64
	cached   []byte
	closed   bool
}

func (r *blobReader) Stat() (fs.FileInfo, error) {
	if r.closed {
		return nil, fs.ErrClosed
	}
	return r.info, nil
}
func (r *blobReader) Close() error {
	if r.closed {
		return nil
	}
	r.closed = true
	r.cached = nil
	err := r.tx.Rollback()
	if errors.Is(err, sql.ErrTxDone) {
		return nil
	}
	return err
}
func (r *blobReader) Seek(offset int64, whence int) (int64, error) {
	if r.closed {
		return 0, fs.ErrClosed
	}
	var position int64
	switch whence {
	case io.SeekStart:
		position = offset
	case io.SeekCurrent:
		position = r.position + offset
	case io.SeekEnd:
		position = r.info.size + offset
	default:
		return 0, fs.ErrInvalid
	}
	if position < 0 {
		return 0, fs.ErrInvalid
	}
	r.position = position
	return position, nil
}
func (r *blobReader) Read(p []byte) (int, error) {
	if r.closed {
		return 0, fs.ErrClosed
	}
	if len(p) == 0 {
		return 0, nil
	}
	if r.position >= r.info.size {
		return 0, io.EOF
	}
	index := r.position / archiveChunkSize
	if r.cachedNo != index {
		var data, hash []byte
		if err := r.tx.QueryRowContext(r.ctx, "SELECT content,chunk_sha256 FROM archive_blob_chunks WHERE blob_id=? AND chunk_no=?", r.blobID, index).Scan(&data, &hash); err != nil {
			return 0, fmt.Errorf("read archive chunk: %w", err)
		}
		expected := min(int64(archiveChunkSize), r.info.size-index*archiveChunkSize)
		if int64(len(data)) != expected || digestBytes(data) != hex.EncodeToString(hash) {
			return 0, fmt.Errorf("archive chunk integrity failure")
		}
		r.cached = data
		r.cachedNo = index
	}
	n := copy(p, r.cached[r.position%archiveChunkSize:])
	r.position += int64(n)
	return n, nil
}

func (s *Server) initializeFileArchive(ctx context.Context) error {
	var backend string
	if err := s.db.QueryRowContext(ctx, "SELECT backend FROM archive_file_storage WHERE singleton=1").Scan(&backend); err != nil {
		return err
	}
	s.files = &fileArchive{mysql: backend == "mysql"}
	return nil
}

func (s *Server) bootstrapEmptyFiles(ctx context.Context) error {
	for _, table := range archiveTables {
		var count int
		if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table.name).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return nil
		}
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if len(entries) != 0 {
		return nil
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE archive_file_storage SET backend='mysql',generation=generation+1,updated_at=UTC_TIMESTAMP(6) WHERE singleton=1 AND backend='filesystem'"); err != nil {
		return err
	}
	s.files.mysql = true
	return nil
}
