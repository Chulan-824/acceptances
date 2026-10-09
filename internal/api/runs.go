package api

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Version struct {
	Repository string `json:"repository"`
	Commit     string `json:"commit"`
	Dirty      *bool  `json:"dirty"`
}
type Check struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Expected string   `json:"expected"`
	Actual   string   `json:"actual"`
	Status   string   `json:"status"`
	Evidence []string `json:"evidence"`
}
type Evidence struct {
	Path        string `json:"path"`
	Description string `json:"description"`
}
type Report struct {
	Title       string     `json:"title"`
	Description string     `json:"description"`
	VerifiedAt  string     `json:"verifiedAt"`
	Scope       string     `json:"scope"`
	Environment string     `json:"environment"`
	Versions    []Version  `json:"versions"`
	Checks      []Check    `json:"checks"`
	Evidence    []Evidence `json:"evidence"`
}
type Review struct {
	ID        string `json:"id"`
	RunID     string `json:"runId"`
	Kind      string `json:"kind"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}
type Run struct {
	ID           string   `json:"id"`
	CampaignID   string   `json:"campaignId"`
	SubmissionID string   `json:"submissionId"`
	Report       Report   `json:"report"`
	Status       string   `json:"status"`
	VoidReason   string   `json:"voidReason"`
	CreatedAt    string   `json:"createdAt"`
	Reviews      []Review `json:"reviews"`
}

func validName(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 200 && !strings.ContainsAny(name, "/\\\x00\r\n")
}
func validateReport(doc *Report) error {
	if strings.TrimSpace(doc.Title) == "" || strings.TrimSpace(doc.Scope) == "" || len(doc.Checks) == 0 {
		return fmt.Errorf("title, scope and checks required")
	}
	if _, e := time.Parse(time.RFC3339Nano, doc.VerifiedAt); e != nil {
		return fmt.Errorf("invalid verifiedAt")
	}
	if strings.TrimSpace(doc.Environment) == "" {
		doc.Environment = "unknown"
	}
	if len(doc.Versions) == 0 {
		doc.Versions = []Version{{Repository: "unknown", Commit: "unknown"}}
	}
	for i := range doc.Versions {
		if doc.Versions[i].Commit == "" {
			doc.Versions[i].Commit = "unknown"
		}
		if doc.Versions[i].Repository == "" {
			doc.Versions[i].Repository = "unknown"
		}
	}
	evidence := map[string]bool{}
	for _, v := range doc.Evidence {
		if !validName(v.Path) || evidence[v.Path] {
			return fmt.Errorf("invalid or duplicate evidence path")
		}
		evidence[v.Path] = true
	}
	if doc.Evidence == nil {
		doc.Evidence = []Evidence{}
	}
	checks := map[string]bool{}
	for i, c := range doc.Checks {
		if c.ID == "" || checks[c.ID] || strings.TrimSpace(c.Title) == "" || strings.TrimSpace(c.Expected) == "" || strings.TrimSpace(c.Actual) == "" {
			return fmt.Errorf("invalid check")
		}
		checks[c.ID] = true
		switch c.Status {
		case "passed", "failed", "blocked", "skipped":
		default:
			return fmt.Errorf("invalid status")
		}
		for _, name := range c.Evidence {
			if !evidence[name] {
				return fmt.Errorf("unknown evidence")
			}
		}
		if c.Evidence == nil {
			doc.Checks[i].Evidence = []string{}
		}
	}
	return nil
}
func (s *Server) submitRun(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 256<<20)
	reader, e := r.MultipartReader()
	if e != nil {
		fail(w, 400, "MULTIPART_REQUIRED")
		return
	}
	stage, e := os.MkdirTemp(s.dir, ".upload-")
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer os.RemoveAll(stage)
	var raw, submission string
	seen := map[string]bool{}
	hashes := map[string]string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			fail(w, 400, "INCOMPLETE_UPLOAD")
			return
		}
		name := part.FormName()
		if name == "report" || name == "submissionId" {
			if seen[name] {
				part.Close()
				fail(w, 400, "DUPLICATE_FIELD")
				return
			}
			seen[name] = true
			data, err := io.ReadAll(io.LimitReader(part, (1<<20)+1))
			part.Close()
			if err != nil || len(data) > 1<<20 {
				fail(w, 400, "INVALID_INPUT")
				return
			}
			if name == "report" {
				raw = string(data)
			} else {
				submission = string(data)
			}
			continue
		}
		if name != "evidence" {
			part.Close()
			fail(w, 400, "UNKNOWN_FIELD")
			return
		}
		filename := part.FileName()
		if !validName(filename) || hashes[filename] != "" {
			part.Close()
			fail(w, 400, "INVALID_EVIDENCE_PATH")
			return
		}
		// Reject raw traversal names too: multipart.FileName strips slash prefixes.
		_, params, parseErr := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		if parseErr != nil || params["filename"] != filename {
			part.Close()
			fail(w, 400, "INVALID_EVIDENCE_PATH")
			return
		}

		file, err := os.OpenFile(filepath.Join(stage, filename), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			part.Close()
			fail(w, 500, "SAVE_FAILED")
			return
		}
		h := sha256.New()
		_, copyErr := io.Copy(io.MultiWriter(file, h), part)
		syncErr := file.Sync()
		closeErr := file.Close()
		part.Close()
		if copyErr != nil {
			fail(w, 400, "INCOMPLETE_UPLOAD")
			return
		}
		if syncErr != nil || closeErr != nil {
			fail(w, 500, "SAVE_FAILED")
			return
		}
		hashes[filename] = hex.EncodeToString(h.Sum(nil))
	}
	if strings.TrimSpace(submission) == "" || len(submission) > 200 {
		fail(w, 400, "SUBMISSION_ID_REQUIRED")
		return
	}
	var doc Report
	d := json.NewDecoder(strings.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&doc) != nil || validateReport(&doc) != nil {
		fail(w, 400, "INVALID_REPORT")
		return
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, "INVALID_REPORT")
		return
	}
	if len(doc.Evidence) != len(hashes) {
		fail(w, 400, "EVIDENCE_MISMATCH")
		return
	}
	for _, v := range doc.Evidence {
		if hashes[v.Path] == "" {
			fail(w, 400, "EVIDENCE_MISSING")
			return
		}
	}
	canonical, _ := json.Marshal(doc)
	h := sha256.New()
	fmt.Fprintf(h, "%s\n%s\n", r.PathValue("id"), canonical)
	names := make([]string, 0, len(hashes))
	for name := range hashes {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		fmt.Fprintf(h, "%s:%s\n", name, hashes[name])
	}
	digest := hex.EncodeToString(h.Sum(nil))
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, e = s.campaign(r.PathValue("id")); e != nil {
		fail(w, 404, "CAMPAIGN_NOT_FOUND")
		return
	}
	var oldID, oldHash string
	e = s.db.QueryRowContext(r.Context(), "SELECT id,hash FROM runs WHERE submission_id=?", submission).Scan(&oldID, &oldHash)
	if e == nil {
		if oldHash != digest {
			fail(w, 409, "SUBMISSION_CONFLICT")
			return
		}
		v, e := s.run(oldID)
		if e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		respond(w, 200, v)
		return
	}
	if e != sql.ErrNoRows {
		fail(w, 500, "READ_FAILED")
		return
	}
	v := Run{ID: id(), CampaignID: r.PathValue("id"), SubmissionID: submission, Report: doc, Status: "pending", CreatedAt: now(), Reviews: []Review{}}
	target := filepath.Join(s.dir, "evidence", v.ID)
	if e = os.Rename(stage, target); e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	committed := false
	defer func() {
		if !committed {
			os.RemoveAll(target)
		}
	}()
	tx, e := s.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(r.Context(), "INSERT INTO runs(id,campaign_id,submission_id,hash,report,status,void_reason,created_at) VALUES(?,?,?,?,?,'pending','',?)", v.ID, v.CampaignID, v.SubmissionID, digest, string(canonical), v.CreatedAt)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "UPDATE campaigns SET latest_run_id=?,status='pending' WHERE id=?", v.ID, v.CampaignID)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	committed = true
	respond(w, 201, v)
}
func (s *Server) run(key string) (Run, error) {
	var v Run
	var raw string
	e := s.db.QueryRow("SELECT id,campaign_id,submission_id,report,status,void_reason,created_at FROM runs WHERE id=?", key).Scan(&v.ID, &v.CampaignID, &v.SubmissionID, &raw, &v.Status, &v.VoidReason, &v.CreatedAt)
	if e != nil {
		return v, e
	}
	if e = json.Unmarshal([]byte(raw), &v.Report); e != nil {
		return v, e
	}
	v.Reviews = []Review{}
	rows, e := s.db.Query("SELECT id,run_id,kind,body,created_at FROM reviews WHERE run_id=? ORDER BY created_at,id", key)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var review Review
		if e = rows.Scan(&review.ID, &review.RunID, &review.Kind, &review.Body, &review.CreatedAt); e != nil {
			return v, e
		}
		v.Reviews = append(v.Reviews, review)
	}
	return v, rows.Err()
}
func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
	v, e := s.run(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "RUN_NOT_FOUND")
		return
	}
	respond(w, 200, v)
}
func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	if _, e := s.campaign(r.PathValue("id")); e != nil {
		fail(w, 404, "CAMPAIGN_NOT_FOUND")
		return
	}
	rows, e := s.db.QueryContext(r.Context(), "SELECT id FROM runs WHERE campaign_id=? ORDER BY created_at DESC,id", r.PathValue("id"))
	if e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	keys := []string{}
	for rows.Next() {
		var key string
		if e = rows.Scan(&key); e != nil {
			rows.Close()
			fail(w, 500, "READ_FAILED")
			return
		}
		keys = append(keys, key)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	out := []Run{}
	for _, key := range keys {
		v, e := s.run(key)
		if e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		out = append(out, v)
	}
	respond(w, 200, map[string]any{"items": out})
}
