package api_test

import (
	"encoding/json"
	"reflect"
	"testing"
)

func followUpReport(t *testing.T, source string, responses ...map[string]any) string {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(reviewReport(t, "partial", "passed")), &doc); err != nil {
		t.Fatal(err)
	}
	doc["followUp"] = map[string]any{"sourceRunId": source, "responses": responses}
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestFeedbackResponseLinksNewRunWithoutClosingHumanReview(t *testing.T) {
	app, _, cid := setup(t)
	source := upload(t, app, cid, "source", report, map[string]string{"log.txt": "failed"}, 201)
	sourceID := source["id"].(string)
	review := request(t, app, "POST", "/api/v1/runs/"+sourceID+"/reviews", `{"checkId":"c1","kind":"rejected","body":"Fix the observed failure"}`, 201)
	reviewID := review["id"].(string)
	doc := followUpReport(t, sourceID, map[string]any{"reviewId": reviewID, "explanation": "Fixed and reverified the behavior", "checkIds": []string{"a"}})
	next := upload(t, app, cid, "follow-up", doc, map[string]string{"log.txt": "passed after correction"}, 201)
	nextID := next["id"].(string)
	got := request(t, app, "GET", "/api/v1/runs/"+nextID, "", 200)
	if got["sourceRunAvailable"] != true || got["status"] != "pending" {
		t.Fatal(got)
	}
	before := got["report"]
	source = request(t, app, "GET", "/api/v1/runs/"+sourceID, "", 200)
	responses := source["feedbackResponses"].([]any)
	if source["status"] != "rejected" || len(responses) != 1 || responses[0].(map[string]any)["runId"] != nextID || responses[0].(map[string]any)["reviewId"] != reviewID {
		t.Fatal(source)
	}
	request(t, app, "DELETE", "/api/v1/runs/"+sourceID, "", 204)
	got = request(t, app, "GET", "/api/v1/runs/"+nextID, "", 200)
	if got["sourceRunAvailable"] != false || !reflect.DeepEqual(before, got["report"]) {
		t.Fatal("deleting source changed the immutable follow-up report", got)
	}
	retry := upload(t, app, cid, "follow-up", doc, map[string]string{"log.txt": "passed after correction"}, 200)
	if retry["id"] != nextID {
		t.Fatal(retry)
	}
	changed := followUpReport(t, sourceID, map[string]any{"reviewId": reviewID, "explanation": "Changed immutable response", "checkIds": []string{"a"}})
	upload(t, app, cid, "follow-up", changed, map[string]string{"log.txt": "passed after correction"}, 409)
	upload(t, app, cid, "new-missing-source", doc, map[string]string{"log.txt": "passed after correction"}, 400)
}

func TestFeedbackResponseRejectsMismatchedAndInvalidReferences(t *testing.T) {
	app, pid, cid := setup(t)
	source := upload(t, app, cid, "source", report, map[string]string{"log.txt": "failed"}, 201)
	sourceID := source["id"].(string)
	reviewID := request(t, app, "POST", "/api/v1/runs/"+sourceID+"/reviews", `{"kind":"comment","body":"Additional issue"}`, 201)["id"].(string)
	otherCID := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"Other feature"}`, 201)["id"].(string)
	otherID := upload(t, app, otherCID, "other", report, map[string]string{"log.txt": "failed"}, 201)["id"].(string)
	otherReview := request(t, app, "POST", "/api/v1/runs/"+otherID+"/reviews", `{"kind":"comment","body":"Other feedback"}`, 201)["id"].(string)
	response := func(review, explanation string, checks ...string) map[string]any {
		return map[string]any{"reviewId": review, "explanation": explanation, "checkIds": checks}
	}
	cases := []struct {
		name, source string
		responses    []map[string]any
	}{
		{"missing-source", "missing", []map[string]any{response(reviewID, "Handled", "a")}},
		{"other-campaign", otherID, []map[string]any{response(otherReview, "Handled", "a")}},
		{"wrong-review", sourceID, []map[string]any{response(otherReview, "Handled", "a")}},
		{"missing-review", sourceID, []map[string]any{response("missing", "Handled", "a")}},
		{"empty-explanation", sourceID, []map[string]any{response(reviewID, " \n", "a")}},
		{"unknown-check", sourceID, []map[string]any{response(reviewID, "Handled", "other")}},
		{"duplicate-check", sourceID, []map[string]any{response(reviewID, "Handled", "a", "a")}},
		{"duplicate-response", sourceID, []map[string]any{response(reviewID, "Handled", "a"), response(reviewID, "Same again", "a")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			upload(t, app, cid, tc.name, followUpReport(t, tc.source, tc.responses...), map[string]string{"log.txt": "observed"}, 400)
		})
	}
	run := upload(t, app, cid, "no-check-response", followUpReport(t, sourceID, response(reviewID, "Blocked: the target environment is unavailable")), map[string]string{"log.txt": "observed"}, 201)
	if run["status"] != "pending" {
		t.Fatal(run)
	}
}
