package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/Chulan-824/acceptances/internal/model"
)

// Supplements correct provenance and append materials, never verification facts.
type RunSupplementInput struct {
	RequestID             string              `json:"requestId"`
	Token                 string              `json:"token"`
	Reason                string              `json:"reason"`
	VerificationUnchanged bool                `json:"verificationUnchanged"`
	Versions              []Version           `json:"versions,omitempty"`
	Evidence              []Evidence          `json:"evidence"`
	CheckEvidence         map[string][]string `json:"checkEvidence,omitempty"`
}

type RunSupplement struct {
	ID               string      `json:"id"`
	CreatedAt        string      `json:"createdAt"`
	CreatedBy        *model.User `json:"createdBy,omitempty"`
	PreviousVersions []Version   `json:"previousVersions"`
	RunSupplementInput
	Files []ArchivedFile `json:"files"`
}

func (s *Server) loadRunSupplements(run *Run) error {
	rows, err := s.db.Query("SELECT payload FROM run_supplements WHERE run_id=? ORDER BY seq", run.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		var addition RunSupplement
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(raw), &addition); err != nil {
			return err
		}
		run.Supplements = append(run.Supplements, addition)
		applyRunSupplement(&run.Report, addition.RunSupplementInput)
	}
	return rows.Err()
}

func applyRunSupplement(report *Report, in RunSupplementInput) {
	if len(in.Versions) != 0 {
		report.Versions = in.Versions
	}
	report.Evidence = append(report.Evidence, in.Evidence...)
	for i := range report.Checks {
		report.Checks[i].Evidence = append(report.Checks[i].Evidence, in.CheckEvidence[report.Checks[i].ID]...)
	}
}

// ReadRunSupplement validates only the new files. Existing evidence is checked
// against the stored Run by the server, including material references and hashes.
func ReadRunSupplement(directory string) (RunSupplementInput, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return RunSupplementInput{}, err
	}
	defer root.Close()
	var in RunSupplementInput
	if err = readMaterial(root.FS(), "supplement.json", &in); err != nil {
		return in, err
	}
	if strings.TrimSpace(in.RequestID) == "" || len(in.RequestID) > 200 || in.Token == "" || strings.TrimSpace(in.Reason) == "" || len(in.Reason) > 4000 || !in.VerificationUnchanged || len(in.Versions) == 0 && len(in.Evidence) == 0 {
		return in, fmt.Errorf("需要提交标识、最新准备token、补充依据，并确认验证事实不变")
	}
	if len(in.Versions) > 0 {
		if err = validateDeliverySources(in.Versions); err != nil {
			return in, err
		}
	}
	seen := map[string]bool{}
	for _, e := range in.Evidence {
		if !validName(e.Path) || e.Path == "supplement.json" || seen[e.Path] {
			return in, fmt.Errorf("补充附件文件名无效或重复")
		}
		seen[e.Path] = true
	}
	return in, validateBundleFiles(root, in.Evidence)
}

type supplementedFiles struct {
	added    fs.FS
	existing fs.FS
	names    map[string]bool
}

func (f supplementedFiles) Open(name string) (fs.File, error) {
	if f.names[name] {
		return f.added.Open(name)
	}
	return f.existing.Open(name)
}

func (s *Server) supplementRun(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 256<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		fail(w, 400, "INVALID_SUPPLEMENT_UPLOAD")
		return
	}
	defer r.MultipartForm.RemoveAll()
	form := r.MultipartForm
	if len(form.Value) != 1 || len(form.Value["supplement"]) != 1 || len(form.File) > 1 || len(form.File["evidence"]) == 0 && len(form.File) != 0 || len(form.Value["supplement"][0]) > 1<<20 {
		fail(w, 400, "INVALID_SUPPLEMENT_UPLOAD")
		return
	}
	dir, err := os.MkdirTemp("", "acceptances-supplement-*")
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer os.RemoveAll(dir)
	root, err := os.OpenRoot(dir)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer root.Close()
	if err = root.WriteFile("supplement.json", []byte(form.Value["supplement"][0]), 0600); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	names := map[string]bool{}
	for _, header := range form.File["evidence"] {
		name := header.Filename
		_, params, parseErr := mime.ParseMediaType(header.Header.Get("Content-Disposition"))
		if parseErr != nil || params["filename"] != name || !validName(name) || name == "supplement.json" || names[name] {
			fail(w, 400, "INVALID_EVIDENCE_PATH")
			return
		}
		names[name] = true
		file, err := header.Open()
		if err != nil {
			fail(w, 400, "INCOMPLETE_UPLOAD")
			return
		}
		output, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			file.Close()
			fail(w, 500, "SAVE_FAILED")
			return
		}
		_, copyErr := io.Copy(output, file)
		if err = errors.Join(copyErr, file.Close(), output.Close()); err != nil {
			fail(w, 400, "INCOMPLETE_UPLOAD")
			return
		}
	}
	in, err := ReadRunSupplement(dir)
	if err != nil {
		deliveryFailure(w, 400, "INVALID_SUPPLEMENT", err.Error())
		return
	}
	if len(names) != len(in.Evidence) {
		fail(w, 400, "EVIDENCE_MISMATCH")
		return
	}
	for _, e := range in.Evidence {
		if !names[e.Path] {
			fail(w, 400, "EVIDENCE_MISMATCH")
			return
		}
	}
	files, err := archiveFiles(root.FS(), in.Evidence)
	if err != nil {
		deliveryFailure(w, 400, "INVALID_SUPPLEMENT", err.Error())
		return
	}
	canonical, err := json.Marshal(struct {
		RunID string
		Input RunSupplementInput
		Files []ArchivedFile
	}{r.PathValue("id"), in, files})
	if err != nil {
		fail(w, 400, "INVALID_SUPPLEMENT")
		return
	}
	requestHash := digestBytes(canonical)
	s.mu.Lock()
	defer s.mu.Unlock()
	var previousHash, previousRun string
	err = s.db.QueryRowContext(r.Context(), "SELECT request_hash,run_id FROM run_supplements WHERE request_id=?", in.RequestID).Scan(&previousHash, &previousRun)
	if err == nil {
		if previousHash != requestHash || previousRun != r.PathValue("id") {
			fail(w, 409, "SUPPLEMENT_REQUEST_CONFLICT")
			return
		}
		s.getRun(w, r)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 500, "READ_FAILED")
		return
	}
	prep, err := s.prepareDelivery(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "RUN_NOT_FOUND")
		return
	}
	if prep.Token != in.Token {
		fail(w, 409, "STALE_DELIVERY_CONFIRMATION")
		return
	}
	if prep.Run.Status == "void" || prep.Run.ConsolidatedInto != nil {
		fail(w, 409, "RUN_NOT_SUPPLEMENTABLE")
		return
	}
	for _, issue := range prep.Issues {
		if issue.Code == "EVIDENCE_UNAVAILABLE" {
			deliveryFailure(w, 409, "EVIDENCE_UNAVAILABLE", "原证据不可读，请先恢复原附件，不能用补充资料替代。")
			return
		}
	}
	var frozen bool
	if err = s.db.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM delivery_snapshots WHERE source_run_id=?)", prep.Run.ID).Scan(&frozen); err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	if frozen {
		fail(w, 409, "RUN_HAS_FROZEN_DELIVERY")
		return
	}
	if !s.databaseFiles() {
		deliveryFailure(w, 409, "MYSQL_FILES_REQUIRED", "请先完成MySQL附件迁移再补齐资料。")
		return
	}
	for _, e := range prep.Run.Report.Evidence {
		if names[e.Path] {
			deliveryFailure(w, 409, "EVIDENCE_EXISTS", "原附件不能覆盖，请为补充附件使用新文件名。")
			return
		}
	}
	if len(in.Versions) > 0 {
		old := map[string]bool{}
		for _, v := range prep.Run.Report.Versions {
			old[v.Repository] = true
		}
		if !old["unknown"] {
			if len(old) != len(in.Versions) {
				fail(w, 400, "SOURCE_IDENTITY_MISMATCH")
				return
			}
			for _, v := range in.Versions {
				if !old[v.Repository] {
					fail(w, 400, "SOURCE_IDENTITY_MISMATCH")
					return
				}
			}
		}
	}
	knownChecks := map[string]bool{}
	for _, c := range prep.Run.Report.Checks {
		knownChecks[c.ID] = true
	}
	for key, paths := range in.CheckEvidence {
		if !knownChecks[key] || len(paths) == 0 {
			fail(w, 400, "INVALID_CHECK_EVIDENCE")
			return
		}
		seen := map[string]bool{}
		for _, path := range paths {
			if !names[path] || seen[path] {
				fail(w, 400, "INVALID_CHECK_EVIDENCE")
				return
			}
			seen[path] = true
		}
	}
	addition := RunSupplement{ID: id(), CreatedAt: now(), CreatedBy: model.CurrentUser(r.Context()), PreviousVersions: prep.Run.Report.Versions, RunSupplementInput: in, Files: files}
	applyRunSupplement(&prep.Run.Report, in)
	if err = validateReport(&prep.Run.Report); err != nil {
		deliveryFailure(w, 400, "INVALID_SUPPLEMENT", err.Error())
		return
	}
	existing, err := s.openFiles(r.Context(), fileOwner{"evidence", prep.Run.ID})
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	defer existing.Close()
	merged := supplementedFiles{root.FS(), existing, names}
	prep.Files = append(prep.Files, files...)
	slices.SortFunc(prep.Files, func(a, b ArchivedFile) int { return strings.Compare(a.Path, b.Path) })
	var total int64
	for _, f := range prep.Files {
		total += f.Size
	}
	if total > 256<<20 {
		deliveryFailure(w, 400, "INVALID_SUPPLEMENT", "补充后附件总量超过256 MiB。")
		return
	}
	if slices.ContainsFunc(prep.Run.Report.Evidence, func(e Evidence) bool { return e.Path == deliveryManifestName }) {
		if prep.Run.Report.ScopeType != "full" {
			fail(w, 400, "FULL_SCOPE_REQUIRED")
			return
		}
		if err = loadDeliveryMaterials(merged, &prep); err != nil {
			deliveryFailure(w, 400, "DELIVERY_MATERIALS_INVALID", err.Error())
			return
		}
	}
	batch, err := s.beginFileBatch(r.Context())
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer batch.Close()
	for _, e := range in.Evidence {
		file, err := root.Open(e.Path)
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		_, putErr := batch.put(e.Path, file)
		if err = errors.Join(putErr, file.Close()); err != nil {
			fail(w, 500, "SAVE_FAILED")
			return
		}
	}
	raw, err := json.Marshal(addition)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	err = batch.publishRun(r.Context(), fileOwner{"evidence", prep.Run.ID}, func(tx *sql.Tx) error {
		if err := s.lockArchiveRow(r.Context(), tx, "runs", prep.Run.ID); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), "INSERT INTO run_supplements(id,run_id,request_id,request_hash,payload) VALUES(?,?,?,?,?)", addition.ID, prep.Run.ID, in.RequestID, requestHash, string(raw))
		return err
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "supplement run failed", "runId", prep.Run.ID, "error", err)
		fail(w, 500, "SAVE_FAILED")
		return
	}
	run, err := s.run(prep.Run.ID)
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	respond(w, 201, run)
}
