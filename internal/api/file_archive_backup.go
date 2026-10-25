package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type archiveTable struct {
	name     string
	columns  string
	sequence bool
}

// Explicit columns preserve raw reports, timestamps and saved sequence order.
var archiveTables = []archiveTable{
	{"projects", "id,name,description,created_at", false},
	{"repositories", "id,project_id,name,source", false},
	{"campaigns", "id,project_id,title,description,status,latest_run_id,created_at", false},
	{"runs", "id,campaign_id,submission_id,hash,report,status,void_reason,created_at", true},
	{"reviews", "id,run_id,kind,body,created_at,check_id,legacy", true},
	{"delivery_snapshots", "id,project_id,campaign_id,source_run_id,version,request_id,request_hash,payload,content_hash,status,successor_id,created_at", true},
	{"delivery_requests", "request_id,request_hash,delivery_id", false},
	{"delivery_events", "id,delivery_id,kind,reason,reference,created_at", true},
	{"business_documents", "id,delivery_id,kind,guide,version,request_id,template_version,status,attempts,error,content_hash,created_at,completed_at", false},
	{"run_moves", "id,run_id,request_id,from_campaign_id,to_campaign_id,reason,created_at", true},
	{"run_consolidations", "id,request_id,source_run_id,primary_run_id,from_campaign_id,reason,created_at", true},
}

type archiveQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readArchiveTable(ctx context.Context, db archiveQueryer, table archiveTable) ([][]string, error) {
	columns, order := table.columns, strings.Split(table.columns, ",")[0]
	if table.sequence {
		order = "seq"
		columns += "," + order
	}
	rows, err := db.QueryContext(ctx, "SELECT "+columns+" FROM "+table.name+" ORDER BY "+order)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	width := len(strings.Split(columns, ","))
	result := [][]string{}
	for rows.Next() {
		values := make([]any, width)
		pointers := make([]any, width)
		for i := range values {
			pointers[i] = &values[i]
		}
		if err = rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make([]string, width)
		for i, v := range values {
			switch v := v.(type) {
			case []byte:
				row[i] = string(v)
			case nil:
				return nil, fmt.Errorf("unexpected NULL in %s", table.name)
			default:
				row[i] = fmt.Sprint(v)
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func tableDigest(rows [][]string) string {
	data, _ := json.Marshal(rows)
	return digestBytes(data)
}

type backupFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

func backupArchive(dir string) (string, int, int64, error) {
	parent := filepath.Join(dir, ".backups")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return "", 0, 0, err
	}
	backup, err := os.MkdirTemp(parent, "mysql-import-"+time.Now().UTC().Format("20060102T150405")+"-")
	if err != nil {
		return "", 0, 0, err
	}
	files := []backupFile{}
	var size int64
	err = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		if entry.IsDir() && rel == ".backups" {
			return filepath.SkipDir
		}
		target := filepath.Join(backup, "data", rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("archive backup refuses nonregular file %s", rel)
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(output, hash), input)
		syncErr := output.Sync()
		closeErr := output.Close()
		if err = errors.Join(copyErr, syncErr, closeErr); err != nil {
			return err
		}
		files = append(files, backupFile{filepath.ToSlash(rel), n, hex.EncodeToString(hash.Sum(nil))})
		size += n
		return nil
	})
	if err != nil {
		return backup, 0, 0, err
	}
	manifest, _ := json.MarshalIndent(files, "", "  ")
	err = os.WriteFile(filepath.Join(backup, "files.json"), manifest, 0600)
	return backup, len(files), size, err
}
