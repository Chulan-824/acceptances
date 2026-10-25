package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/go-sql-driver/mysql"
)

type fileContent struct {
	blobID   uint64
	size     int64
	sha256   string
	modified time.Time
}
type fileBatch struct {
	s       *Server
	ctx     context.Context
	stage   string
	files   map[string]fileContent
	token   [16]byte
	created []uint64
}

func (s *Server) beginFileBatch(ctx context.Context) (*fileBatch, error) {
	b := &fileBatch{s: s, ctx: ctx, files: map[string]fileContent{}}
	if _, err := rand.Read(b.token[:]); err != nil {
		return nil, err
	}
	if !s.databaseFiles() {
		var err error
		b.stage, err = os.MkdirTemp(s.dir, ".upload-")
		if err != nil {
			return nil, err
		}
	}
	return b, nil
}

func (b *fileBatch) Close() {
	if b.stage != "" {
		_ = os.RemoveAll(b.stage)
		return
	}
	// Ready objects may belong to an ambiguous COMMIT or another deduplicating
	// batch. Keep them; maintenance decides reachability after writers stop.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, key := range b.created {
		_ = b.s.deliveryTransaction(ctx, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, "DELETE FROM archive_blobs WHERE id=? AND state='staging' AND write_token=?", key, b.token[:])
			return err
		})
	}
}

func (b *fileBatch) write(name string, render func(io.Writer) error) (fileContent, error) {
	if !validName(name) {
		return fileContent{}, fmt.Errorf("invalid filename")
	}
	if _, ok := b.files[name]; ok {
		return fileContent{}, fmt.Errorf("duplicate filename")
	}
	if !b.s.databaseFiles() {
		file, err := os.OpenFile(filepath.Join(b.stage, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return fileContent{}, err
		}
		h := sha256.New()
		w := &artifactWriter{Writer: io.MultiWriter(file, h)}
		writeErr := render(w)
		syncErr := file.Sync()
		closeErr := file.Close()
		if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
			return fileContent{}, err
		}
		content := fileContent{size: w.size, sha256: hex.EncodeToString(h.Sum(nil)), modified: time.Now().UTC()}
		b.files[name] = content
		return content, nil
	}
	var key int64
	err := b.s.deliveryTransaction(b.ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(b.ctx, "INSERT INTO archive_blobs(write_token) VALUES(?)", b.token[:])
		if err != nil {
			return err
		}
		key, err = result.LastInsertId()
		return err
	})
	if err != nil {
		return fileContent{}, err
	}
	b.created = append(b.created, uint64(key))
	w := &chunkWriter{batch: b, key: uint64(key), hash: sha256.New(), buffer: make([]byte, 0, archiveChunkSize)}
	if err = render(w); err != nil {
		return fileContent{}, err
	}
	if err = w.flush(); err != nil {
		return fileContent{}, err
	}
	content := fileContent{blobID: uint64(key), size: w.size, sha256: hex.EncodeToString(w.hash.Sum(nil)), modified: time.Now().UTC()}
	if err = b.seal(&content, w.chunks); err != nil {
		return fileContent{}, err
	}
	b.files[name] = content
	return content, nil
}

func (b *fileBatch) put(name string, reader io.Reader) (fileContent, error) {
	return b.write(name, func(w io.Writer) error { _, err := io.Copy(w, fileInputReader{reader}); return err })
}

type fileInputError struct{ error }
type fileInputReader struct{ io.Reader }

func (r fileInputReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if err != nil && err != io.EOF {
		return n, &fileInputError{err}
	}
	return n, err
}

type chunkWriter struct {
	batch  *fileBatch
	key    uint64
	hash   hash.Hash
	buffer []byte
	chunks int
	size   int64
}

func (w *chunkWriter) Write(data []byte) (int, error) {
	written := 0
	for len(data) > 0 {
		n := min(len(data), archiveChunkSize-len(w.buffer))
		w.buffer = append(w.buffer, data[:n]...)
		w.hash.Write(data[:n])
		w.size += int64(n)
		written += n
		data = data[n:]
		if len(w.buffer) == archiveChunkSize {
			if err := w.flush(); err != nil {
				return written, err
			}
		}
	}
	return written, nil
}
func (w *chunkWriter) flush() error {
	if len(w.buffer) == 0 {
		return nil
	}
	h := sha256.Sum256(w.buffer)
	err := w.batch.s.deliveryTransaction(w.batch.ctx, func(tx *sql.Tx) error {
		var owned int
		if err := tx.QueryRowContext(w.batch.ctx, "SELECT COUNT(*) FROM archive_blobs WHERE id=? AND write_token=? AND state='staging'", w.key, w.batch.token[:]).Scan(&owned); err != nil {
			return err
		}
		if owned != 1 {
			return fmt.Errorf("file write ownership lost")
		}
		_, err := tx.ExecContext(w.batch.ctx, "INSERT INTO archive_blob_chunks(blob_id,chunk_no,content,chunk_sha256) VALUES(?,?,?,?)", w.key, w.chunks, w.buffer, h[:])
		return err
	})
	if err != nil {
		return err
	}
	w.chunks++
	w.buffer = w.buffer[:0]
	return nil
}

func (b *fileBatch) seal(content *fileContent, chunks int) error {
	// Verify bytes actually persisted, including empty files, before visibility.
	if err := verifyBlob(b.ctx, b.s.db, content.blobID, content.size, content.sha256); err != nil {
		return err
	}
	hashBytes, _ := hex.DecodeString(content.sha256)
	err := b.s.deliveryTransaction(b.ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(b.ctx, "UPDATE archive_blobs SET state='ready',sha256=?,size_bytes=?,chunk_count=?,sealed_at=UTC_TIMESTAMP(6),touched_at=UTC_TIMESTAMP(6) WHERE id=? AND write_token=? AND state='staging'", hashBytes, content.size, chunks, content.blobID, b.token[:])
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err == nil && count != 1 {
			return fmt.Errorf("file sealing ownership lost")
		}
		return err
	})
	if err == nil {
		return nil
	}
	duplicate, ok := errors.AsType[*mysql.MySQLError](err)
	if !ok || duplicate.Number != 1062 {
		return err
	}
	var existing uint64
	var size int64
	if err = b.s.db.QueryRowContext(b.ctx, "SELECT id,size_bytes FROM archive_blobs WHERE sha256=? AND state='ready'", hashBytes).Scan(&existing, &size); err != nil {
		return err
	}
	if size != content.size {
		return fmt.Errorf("SHA-256 collision: content size differs")
	}
	var different int
	if err = b.s.db.QueryRowContext(b.ctx, `SELECT COUNT(*) FROM archive_blob_chunks a JOIN archive_blob_chunks c ON c.blob_id=? AND c.chunk_no=a.chunk_no WHERE a.blob_id=? AND NOT (a.content <=> c.content)`, existing, content.blobID).Scan(&different); err != nil {
		return err
	}
	if different != 0 {
		return fmt.Errorf("SHA-256 collision: content differs")
	}
	if err = verifyBlob(b.ctx, b.s.db, existing, size, content.sha256); err != nil {
		return err
	}
	old := content.blobID
	content.blobID = existing
	return b.s.deliveryTransaction(b.ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(b.ctx, "DELETE FROM archive_blobs WHERE id=? AND state='staging' AND write_token=?", old, b.token[:])
		return err
	})
}

func verifyBlob(ctx context.Context, db archiveQueryer, key uint64, size int64, expected string) error {
	rows, err := db.QueryContext(ctx, "SELECT chunk_no,content,chunk_sha256 FROM archive_blob_chunks WHERE blob_id=? ORDER BY chunk_no", key)
	if err != nil {
		return err
	}
	defer rows.Close()
	h := sha256.New()
	var total int64
	index := 0
	for rows.Next() {
		var number int
		var data, hashBytes []byte
		if err = rows.Scan(&number, &data, &hashBytes); err != nil {
			return err
		}
		if number != index || int64(len(data)) != min(int64(archiveChunkSize), size-total) || len(data) == 0 || !bytes.Equal(sha256Bytes(data), hashBytes) {
			return fmt.Errorf("file chunk sequence or checksum mismatch")
		}
		h.Write(data)
		total += int64(len(data))
		index++
	}
	if err = rows.Err(); err != nil {
		return err
	}
	if total != size || hex.EncodeToString(h.Sum(nil)) != expected {
		return fmt.Errorf("file content checksum mismatch")
	}
	return nil
}
func sha256Bytes(data []byte) []byte { h := sha256.Sum256(data); return h[:] }

func attachFile(ctx context.Context, tx *sql.Tx, owner fileOwner, name string, content fileContent) error {
	table, column, err := owner.relation()
	if err != nil {
		return err
	}
	columns := column + ",blob_id,modified_at"
	marks := "?,?,?"
	values := []any{owner.id, content.blobID, content.modified}
	if owner.kind != "documents" {
		columns += ",filename"
		marks += ",?"
		values = append(values, name)
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO "+table+"("+columns+") VALUES("+marks+")", values...)
	return err
}

func (b *fileBatch) publishRun(ctx context.Context, owner fileOwner, persist func(*sql.Tx) error) error {
	if b.s.databaseFiles() {
		return b.s.deliveryTransaction(ctx, func(tx *sql.Tx) error {
			if err := persist(tx); err != nil {
				return err
			}
			for name, content := range b.files {
				if err := attachFile(ctx, tx, owner, name, content); err != nil {
					return err
				}
			}
			return nil
		})
	}
	target := owner.directory(b.s.dir)
	if err := b.s.checkTransactionLease(ctx, b.s.db); err != nil {
		return err
	}
	if err := os.Rename(b.stage, target); err != nil {
		return err
	}
	b.stage = ""
	err := b.s.deliveryTransaction(ctx, persist)
	if err != nil {
		check, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		var key string
		if readErr := b.s.db.QueryRowContext(check, "SELECT id FROM runs WHERE id=? FOR UPDATE", owner.id).Scan(&key); !errors.Is(readErr, sql.ErrNoRows) {
			return err
		}
		_ = os.RemoveAll(target)
	}
	return err
}
