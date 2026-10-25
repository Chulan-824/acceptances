package api

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

type deletionPreview struct {
	Projects           int `json:"projects"`
	Campaigns          int `json:"campaigns"`
	Runs               int `json:"runs"`
	Evidence           int `json:"evidence"`
	Reviews            int `json:"reviews"`
	RetainedDeliveries int `json:"retainedDeliveries"`
	RetainedDocuments  int `json:"retainedDocuments"`
	PRDSnapshots       int `json:"prdSnapshots"`
	PRDFiles           int `json:"prdFiles"`
}

func (s *Server) deleteScope(w http.ResponseWriter, r *http.Request, kind string, remove bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := r.PathValue("id")
	where := "id=?"
	preview := deletionPreview{}
	var exists string
	if e := s.db.QueryRow("SELECT id FROM "+kind+" WHERE id=?", key).Scan(&exists); e != nil {
		lookupFailure(w, r, e, "NOT_FOUND")
		return
	}
	switch kind {
	case "projects":
		preview.Projects = 1
		if e := s.db.QueryRow("SELECT count(*) FROM campaigns WHERE project_id=?", key).Scan(&preview.Campaigns); e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		where = "campaign_id IN (SELECT id FROM campaigns WHERE project_id=?)"
	case "campaigns":
		preview.Campaigns = 1
		where = "campaign_id=?"
	}
	if kind != "runs" {
		if err := s.db.QueryRow("SELECT COUNT(*) FROM prd_snapshots WHERE "+where, key).Scan(&preview.PRDSnapshots); err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if err := s.db.QueryRow("SELECT COUNT(*) FROM prd_import_files WHERE import_id IN (SELECT id FROM prd_imports WHERE "+where+")", key).Scan(&preview.PRDFiles); err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
	}
	rows, e := s.db.Query("SELECT id FROM runs WHERE "+where, key)
	if e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	keys := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			fail(w, 500, "READ_FAILED")
			return
		}
		keys = append(keys, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	preview.Runs = len(keys)
	for _, id := range keys {
		v, e := s.run(id)
		if e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		preview.Evidence += len(v.Report.Evidence)
		preview.Reviews += len(v.Reviews)
		var deliveries, documents int
		if e = s.db.QueryRow("SELECT count(*) FROM delivery_snapshots WHERE source_run_id=?", id).Scan(&deliveries); e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if e = s.db.QueryRow("SELECT count(*) FROM business_documents WHERE delivery_id IN (SELECT id FROM delivery_snapshots WHERE source_run_id=?)", id).Scan(&documents); e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		preview.RetainedDeliveries += deliveries
		preview.RetainedDocuments += documents
	}
	if remove && kind == "runs" {
		var grouped bool
		if err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM run_consolidations WHERE source_run_id=? OR primary_run_id=?)`, key, key).Scan(&grouped); err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if grouped {
			fail(w, 409, "RUN_HAS_CONSOLIDATION")
			return
		}
	}
	if !remove {
		respond(w, 200, preview)
		return
	}
	tx, e := s.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 500, "DELETE_FAILED")
		return
	}
	defer tx.Rollback()
	for _, runID := range keys {
		if e = invalidateRunDeliveries(r.Context(), tx, runID, "来源验证记录已删除，交付档案及复制证据保留。", runID); e != nil {
			fail(w, 500, "DELETE_FAILED")
			return
		}
	}
	if kind == "runs" {
		_, e = tx.ExecContext(r.Context(), "UPDATE campaigns SET latest_run_id='',status='pending' WHERE latest_run_id=?", key)
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "DELETE FROM "+kind+" WHERE id=?", key)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 500, "DELETE_FAILED")
		return
	}
	for _, key := range keys {
		if s.databaseFiles() {
			continue
		}
		if e = os.RemoveAll(filepath.Join(s.dir, "evidence", key)); e != nil {
			fail(w, 500, "EVIDENCE_CLEANUP_FAILED")
			return
		}
	}
	respond(w, 204, nil)
}

// The database decides visibility. A crash before committing an upload or after
// deleting a record can leave files only; startup removes those unreferenced files.
func (s *Server) cleanupOrphans() error {
	if s.databaseFiles() {
		_, err := s.db.Exec("UPDATE business_documents SET status='failed',error='服务重启中断了生成，请重试。',completed_at=? WHERE status='generating'", now())
		return err
	}
	entries, e := os.ReadDir(filepath.Join(s.dir, "evidence"))
	if e != nil {
		return e
	}
	for _, entry := range entries {
		var key string
		e = s.db.QueryRow("SELECT id FROM runs WHERE id=?", entry.Name()).Scan(&key)
		if e == sql.ErrNoRows {
			if e = os.RemoveAll(filepath.Join(s.dir, "evidence", entry.Name())); e != nil {
				return fmt.Errorf("cleanup evidence: %w", e)
			}
		} else if e != nil {
			return e
		}
	}
	entries, e = os.ReadDir(s.dir)
	if e != nil {
		return e
	}
	for _, entry := range entries {
		if entry.IsDir() && len(entry.Name()) > 8 && entry.Name()[:8] == ".upload-" {
			if e = os.RemoveAll(filepath.Join(s.dir, entry.Name())); e != nil {
				return e
			}
		}
	}
	return s.recoverDeliveryArtifacts()
}
