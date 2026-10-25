package api_test

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestMySQLFilesRangesDedupAndPublication(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	dir := t.TempDir()
	app, err := api.OpenMySQL(dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	pid := request(t, app, "POST", "/api/v1/projects", `{"name":"SQL file fixture"}`, 201)["id"].(string)
	cid := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"SQL files"}`, 201)["id"].(string)
	f := newDeliveryFixture(t, pid, cid)
	video := strings.Repeat("0123456789abcdef", 131073) // Cross two chunk boundaries.
	for name, data := range map[string]string{"video.mp4": video, "Video.mp4": video, "empty.bin": ""} {
		f.Files[name] = data
		f.Report.Evidence = append(f.Report.Evidence, api.Evidence{Path: name, Description: "Boundary fixture"})
	}
	f.finalize(t)
	rid := publishDeliveryFixture(t, app, cid, "chunk-boundaries", f)
	base := "/api/v1/runs/" + rid + "/evidence/"
	for _, tc := range []struct {
		method, name, rang string
		status             int
		body               string
	}{
		{"GET", "video.mp4", "", 200, video},
		{"GET", "Video.mp4", "bytes=1048570-1048590", 206, video[1048570:1048591]},
		{"GET", "video.mp4", "bytes=-16", 206, video[len(video)-16:]},
		{"HEAD", "video.mp4", "", 200, ""},
		{"GET", "empty.bin", "", 200, ""},
		{"GET", "VIDEO.mp4", "", 404, ""},
		{"GET", "video.mp4", "bytes=9999999-", 416, ""},
	} {
		r := localRequest(tc.method, base+tc.name, nil)
		if tc.rang != "" {
			r.Header.Set("Range", tc.rang)
		}
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, r)
		if w.Code != tc.status || tc.status < 400 && w.Body.String() != tc.body {
			t.Fatalf("%s %s %s: %d bytes=%d", tc.method, tc.name, tc.rang, w.Code, w.Body.Len())
		}
	}
	var blobs, chunks, refs int
	if err = db.QueryRow("SELECT COUNT(DISTINCT blob_id),COUNT(*) FROM run_files WHERE run_id=?", rid).Scan(&blobs, &refs); err != nil {
		t.Fatal(err)
	}
	if blobs != len(f.Files)-1 || refs != len(f.Files) {
		t.Fatal("dedup/ref counts", blobs, refs)
	}
	if err = db.QueryRow("SELECT chunk_count FROM archive_blobs WHERE sha256=UNHEX(?)", fixtureDigest(video)).Scan(&chunks); err != nil || chunks != 3 {
		t.Fatal("chunk count", chunks, err)
	}
	for _, query := range []string{
		"UPDATE archive_blob_chunks SET content=content",
		"DELETE FROM archive_blob_chunks",
		"UPDATE archive_blobs SET size_bytes=size_bytes WHERE state='ready'",
		"UPDATE run_files SET filename='changed'",
		"DELETE FROM run_files",
		"DELETE FROM archive_blobs WHERE state='ready'",
	} {
		if _, err = db.Exec(query); err == nil {
			t.Fatal("immutable file accepted mutation", query)
		}
	}
	request(t, app, "POST", "/api/v1/runs/"+rid+"/accept-all", `{}`, 200)
	did := freezeFixture(t, app, rid, "sql-freeze")["id"].(string)
	doc := request(t, app, "POST", "/api/v1/deliveries/"+did+"/documents", `{"requestId":"sql-document"}`, 201)
	request(t, app, "DELETE", "/api/v1/projects/"+pid, "", 204)
	for _, path := range []string{"/api/v1/deliveries/" + did + "/evidence/video.mp4", "/api/v1/documents/" + doc["id"].(string) + "/html"} {
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, localRequest("GET", path, nil))
		if w.Code != 200 || w.Body.Len() == 0 {
			t.Fatal("retained frozen content", path, w.Code)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("SQL writes used local storage: %v %v", entries, err)
	}
}

func TestMySQLFileMigrationRejectsChangedSourceAndResumes(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	dir := t.TempDir()
	source := openLegacyMySQL(t, dir, dsn)
	pid := request(t, source, "POST", "/api/v1/projects", `{"name":"file migration"}`, 201)["id"].(string)
	cid := request(t, source, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"file migration"}`, 201)["id"].(string)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	rid := publishDeliveryFixture(t, source, cid, "migration-resume", f)
	request(t, source, "POST", "/api/v1/runs/"+rid+"/accept-all", `{}`, 200)
	freezeFixture(t, source, rid, "migration-resume-freeze")
	source.Close()
	path := filepath.Join(dir, "deliveries")
	entries, err := os.ReadDir(path)
	if err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(path, entries[0].Name(), "evidence", "screen.png")
	old, err := os.ReadFile(image)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(image, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = api.MigrateFilesToMySQL(t.Context(), dir, dsn); err == nil {
		t.Fatal("changed frozen file accepted")
	}
	var mode string
	if err = db.QueryRow("SELECT backend FROM archive_file_storage").Scan(&mode); err != nil || mode != "filesystem" {
		t.Fatal("failed migration activated", mode, err)
	}
	if err = os.WriteFile(image, old, 0600); err != nil {
		t.Fatal(err)
	}
	// A previous stopped attempt already published one exact reference.
	data := []byte(f.Files["screen.png"])
	result, err := db.Exec("INSERT INTO archive_blobs(write_token) VALUES(UNHEX(REPEAT('01',16)))")
	if err != nil {
		t.Fatal(err)
	}
	key, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO archive_blob_chunks VALUES(?,0,?,UNHEX(?))", key, data, fixtureDigest(string(data))); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE archive_blobs SET state='ready',sha256=UNHEX(?),size_bytes=?,chunk_count=1,sealed_at=UTC_TIMESTAMP(6) WHERE id=?", fixtureDigest(string(data)), len(data), key); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO run_files VALUES(?,'screen.png',?,UTC_TIMESTAMP(6))", rid, key); err != nil {
		t.Fatal(err)
	}
	files, err := api.MigrateFilesToMySQL(t.Context(), dir, dsn)
	if err != nil || files.Files != 12 {
		t.Fatalf("resume %+v %v", files, err)
	}
	var retained int64
	if err = db.QueryRow("SELECT blob_id FROM run_files WHERE run_id=? AND filename='screen.png'", rid).Scan(&retained); err != nil || retained != key {
		t.Fatal("resume overwrote existing reference", retained, err)
	}
	for _, entry := range []string{image, filepath.Join(files.Backup, "data/deliveries", entries[0].Name(), "evidence/screen.png")} {
		if _, err = os.Stat(entry); err != nil {
			t.Fatal("source/backup removed", entry, err)
		}
	}
	actual, err := os.ReadFile(image)
	if err != nil || !bytes.Equal(old, actual) {
		t.Fatal("source bytes changed", err)
	}
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest("GET", fmt.Sprintf("/api/v1/runs/%s/evidence/screen.png", rid), nil))
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) {
		t.Fatal("resumed content", w.Code)
	}
}

func TestMySQLInterruptedFileUploadNeverPublishes(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	pid := request(t, app, "POST", "/api/v1/projects", `{"name":"Interrupted SQL upload"}`, 201)["id"].(string)
	cid := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"Interrupted SQL upload"}`, 201)["id"].(string)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err = writer.WriteField("submissionId", "interrupted-sql"); err != nil {
		t.Fatal(err)
	}
	if err = writer.WriteField("report", report); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("evidence", "log.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(bytes.Repeat([]byte("x"), 1048577)); err != nil {
		t.Fatal(err)
	}
	// Intentionally omit the closing multipart boundary after a persisted chunk.
	r := localRequest("POST", "/api/v1/campaigns/"+cid+"/runs", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal("incomplete SQL upload", w.Code, w.Body.String())
	}
	for _, table := range []string{"runs", "run_files", "archive_blobs", "archive_blob_chunks"} {
		var n int
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("interrupted upload left %s: %d %v", table, n, err)
		}
	}
	upload(t, app, cid, "interrupted-sql", report, map[string]string{"log.txt": "complete"}, 201)
}
