package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func supplementUpload(t *testing.T, app *api.Server, runID string, input any, files map[string]string, want int) map[string]any {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("supplement", fixtureJSON(t, input)); err != nil {
		t.Fatal(err)
	}
	for name, data := range files {
		part, err := writer.CreateFormFile("evidence", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(part, data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := localRequest("POST", "/api/v1/runs/"+runID+"/delivery-supplements", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	authenticatedHandler(t, app).ServeHTTP(w, r)
	if w.Code != want {
		t.Fatalf("supplement: got %d want %d: %s", w.Code, want, w.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestRunSupplementPreservesVerificationAndReviews(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	pid := request(t, app, "POST", "/api/v1/projects", `{"name":"Supplement fixture"}`, 201)["id"].(string)
	cid := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"Supplement"}`, 201)["id"].(string)
	f := newDeliveryFixture(t, pid, cid)
	const legacyCheckID = "T06-existing"
	f.Report.Checks[0].ID = legacyCheckID
	f.Map.Features[0].Checks[0].ID = legacyCheckID
	f.Materials.Features[0].Steps[0].CheckIDs = []string{legacyCheckID}
	f.Materials.Features[0].Screenshots[0].CheckIDs = []string{legacyCheckID}
	f.Report.Checks[0].Status = "blocked"
	f.Materials.Features[0].Limitations = []string{"Fixture blocked, human accepts this limit."}
	f.finalize(t)
	original := f.Report
	original.Versions = []api.Version{{Repository: "fixture-web", Commit: "unknown"}}
	original.Evidence = []api.Evidence{{Path: "screen.png", Description: "Original evidence"}}
	rid := upload(t, app, cid, "supplement-original", fixtureJSON(t, original), map[string]string{"screen.png": f.Files["screen.png"]}, 201)["id"].(string)
	request(t, app, "POST", "/api/v1/runs/"+rid+"/accept-all", `{}`, 200)
	before := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	var raw, hash string
	if err = db.QueryRow("SELECT report,hash FROM runs WHERE id=?", rid).Scan(&raw, &hash); err != nil {
		t.Fatal(err)
	}
	prep := request(t, app, "GET", "/api/v1/runs/"+rid+"/delivery-preparation", "", 200)
	in := api.RunSupplementInput{RequestID: "supplement-one", Token: prep["token"].(string), Reason: "Deployment provenance confirmed, same completed verification.", VerificationUnchanged: true, Versions: f.Report.Versions}
	files := map[string]string{}
	for _, e := range f.Report.Evidence {
		if e.Path != "screen.png" {
			in.Evidence = append(in.Evidence, e)
			files[e.Path] = f.Files[e.Path]
		}
	}
	files["new.txt"] = "Existing verification log supplied late"
	in.Evidence = append(in.Evidence, api.Evidence{Path: "new.txt", Description: "Late log"})
	in.CheckEvidence = map[string][]string{f.Report.Checks[0].ID: {"new.txt"}}
	for _, tc := range []struct {
		name   string
		change func(*api.RunSupplementInput)
		code   string
	}{
		{"stale", func(i *api.RunSupplementInput) { i.Token = "stale" }, "STALE_DELIVERY_CONFIRMATION"},
		{"wrong repository", func(i *api.RunSupplementInput) {
			i.Versions = []api.Version{{Repository: "other", Commit: strings.Repeat("a", 40), Dirty: new(false)}}
		}, "SOURCE_IDENTITY_MISMATCH"},
		{"unknown check", func(i *api.RunSupplementInput) { i.CheckEvidence = map[string][]string{"unknown": {"new.txt"}} }, "INVALID_CHECK_EVIDENCE"},
		{"check case", func(i *api.RunSupplementInput) {
			i.CheckEvidence = map[string][]string{strings.ToLower(legacyCheckID): {"new.txt"}}
		}, "INVALID_CHECK_EVIDENCE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copy := in
			tc.change(&copy)
			status := 400
			if tc.name == "stale" {
				status = 409
			}
			res := supplementUpload(t, app, rid, copy, files, status)
			if res["code"] != tc.code {
				t.Fatal(res)
			}
		})
	}
	badFiles := map[string]string{}
	for k, v := range files {
		badFiles[k] = v
	}
	badFiles["requirement.md"] = "wrong digest"
	supplementUpload(t, app, rid, in, badFiles, 400)
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM run_supplements").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed addition persisted", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM run_files WHERE run_id=?", rid).Scan(&count); err != nil || count != 1 {
		t.Fatal("failed upload became visible", count, err)
	}
	mutation := map[string]any{}
	if err = json.Unmarshal([]byte(fixtureJSON(t, in)), &mutation); err != nil {
		t.Fatal(err)
	}
	mutation["checks"] = []any{map[string]any{"status": "passed"}}
	supplementUpload(t, app, rid, mutation, files, 400)
	collision := in
	collision.RequestID = "collision"
	collision.Evidence = []api.Evidence{{Path: "screen.png"}}
	collision.CheckEvidence = nil
	// Existing PNG is deliberately not uploaded again; a text collision tests overwrite protection.
	supplementUpload(t, app, rid, collision, map[string]string{"screen.png": "not an image"}, 400)
	after := supplementUpload(t, app, rid, in, files, 201)
	for _, key := range []string{"id", "campaignId", "submissionId", "status", "createdAt", "reviews", "checkReviews", "reviewCounts", "feedbackResponses"} {
		if !reflect.DeepEqual(before[key], after[key]) {
			t.Fatalf("changed %s", key)
		}
	}
	var rawAfter, hashAfter string
	if err = db.QueryRow("SELECT report,hash FROM runs WHERE id=?", rid).Scan(&rawAfter, &hashAfter); err != nil || rawAfter != raw || hashAfter != hash {
		t.Fatal("original report or submission hash changed", err)
	}
	beforeReport := before["report"].(map[string]any)
	afterReport := after["report"].(map[string]any)
	for _, key := range []string{"title", "description", "verifiedAt", "scope", "scopeType", "environment", "followUp"} {
		if !reflect.DeepEqual(beforeReport[key], afterReport[key]) {
			t.Fatalf("verification field changed: %s", key)
		}
	}
	oldCheck := beforeReport["checks"].([]any)[0].(map[string]any)
	newCheck := afterReport["checks"].([]any)[0].(map[string]any)
	for _, key := range []string{"id", "title", "expected", "actual", "status"} {
		if !reflect.DeepEqual(oldCheck[key], newCheck[key]) {
			t.Fatalf("check fact changed: %s", key)
		}
	}
	for _, c := range after["report"].(map[string]any)["checks"].([]any) {
		if c.(map[string]any)["status"] != "blocked" {
			t.Fatal("result changed")
		}
	}
	if after["report"].(map[string]any)["versions"].([]any)[0].(map[string]any)["commit"] == "unknown" {
		t.Fatal("source was not completed")
	}
	if len(after["supplements"].([]any)) != 1 {
		t.Fatal("missing history")
	}
	if supplementUpload(t, app, rid, in, files, 200)["id"] != rid {
		t.Fatal("replay changed run")
	}
	conflict := in
	conflict.Reason = "Different reason"
	supplementUpload(t, app, rid, conflict, files, 409)
	newPrep := request(t, app, "GET", "/api/v1/runs/"+rid+"/delivery-preparation", "", 200)
	if newPrep["eligible"] != true || newPrep["token"] == prep["token"] {
		t.Fatal("readiness did not refresh", newPrep)
	}
	duplicate := in
	duplicate.RequestID = "duplicate"
	duplicate.Token = newPrep["token"].(string)
	supplementUpload(t, app, rid, duplicate, files, 409)
	freeze := preparedFreeze(t, app, rid, "supplement-freeze")
	freeze.ExceptionReasons = map[string]string{f.Report.Checks[0].ID: "Accept fixture limitation"}
	request(t, app, "POST", "/api/v1/runs/"+rid+"/deliveries", fixtureJSON(t, freeze), 201)
	in.RequestID = "after-freeze"
	in.Token = request(t, app, "GET", "/api/v1/runs/"+rid+"/delivery-preparation", "", 200)["token"].(string)
	supplementUpload(t, app, rid, in, files, 409)
	app.Close()
	reopened, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	run := request(t, reopened, "GET", "/api/v1/runs/"+rid, "", 200)
	if len(run["supplements"].([]any)) != 1 || run["status"] != "accepted" {
		t.Fatal("restart lost supplement or review")
	}
	w := httptest.NewRecorder()
	authenticatedHandler(t, reopened).ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+rid+"/evidence/new.txt", nil))
	if w.Code != 200 || w.Body.String() != files["new.txt"] {
		t.Fatal("late evidence unavailable after restart", w.Code)
	}
}
