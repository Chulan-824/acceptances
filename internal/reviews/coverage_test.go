package reviews

import (
	"github.com/Chulan-824/acceptances/internal/protocol"
	"testing"
)

func TestExplicitExecutionSuccessors(t *testing.T) {
	plan := map[string]any{"id": "plan", "documentSha256": "plan-sha", "items": []any{map[string]any{"id": "item", "required": true, "caseRef": map[string]any{"id": "case", "versionId": "cv"}, "executionRef": map[string]any{"id": "execution", "versionId": "ev"}, "environmentRequirements": map[string]any{}, "evidenceRequirements": []any{}}}}
	target := map[string]any{"id": "target", "documentSha256": "target-sha"}
	candidate := func(run, revision string, eligible bool) Candidate {
		return Candidate{RunID: run, RevisionID: revision, ResultID: "result", PlanItemID: "item", TargetID: "target", Result: map[string]any{"id": "result", "caseRef": map[string]any{"id": "case", "versionId": "cv"}, "executionRef": map[string]any{"id": "execution", "versionId": "ev"}, "outcome": "passed", "supersedes": []any{}}, EvaluationID: protocol.NewID(), EvaluationSHA: "evaluation-sha", Evaluation: map[string]any{"results": []any{map[string]any{"resultId": "result", "eligible": eligible, "checks": []any{}}}}}
	}
	first := candidate("r1", "v1", true)
	second := candidate("r2", "v2", false)
	second.Result["outcome"] = "failed"
	s := Snapshot("project", "campaign", plan, target, []Candidate{first, second}, nil, []any{})
	item := obj(arr(s["items"])[0])
	if str(item, "selectionStatus") != "conflict" || s["readiness"] != "not_ready" {
		t.Fatal("parallel results must conflict")
	}
	second.Result["supersedes"] = []any{first.Ref()}
	s = Snapshot("project", "campaign", plan, target, []Candidate{second, first}, nil, []any{})
	item = obj(arr(s["items"])[0])
	if str(obj(item["resultRef"]), "runId") != "r2" || item["eligibility"] != false {
		t.Fatal("new failure must replace old pass independently of upload order")
	}
	second.TargetID = "different-target"
	s = Snapshot("project", "campaign", plan, target, []Candidate{first, second}, nil, []any{})
	if s["readiness"] != "ready" {
		t.Fatal("different target cannot suppress current result")
	}
	replacement := "v1"
	corrected := candidate("r1", "v3", false)
	corrected.Replaces = &replacement
	s = Snapshot("project", "campaign", plan, target, []Candidate{first, corrected}, nil, []any{})
	if s["readiness"] != "not_ready" {
		t.Fatal("correction must invalidate previous passing revision")
	}
}
func TestMissingRequiredCoverage(t *testing.T) {
	plan := map[string]any{"id": "plan", "documentSha256": "sha", "items": []any{map[string]any{"id": "item", "required": true}}}
	s := Snapshot("project", "campaign", plan, map[string]any{"id": "target", "documentSha256": "sha"}, nil, nil, []any{})
	if s["readiness"] != "not_ready" || len(arr(s["items"])) != 1 {
		t.Fatal("missing plan item must remain visible")
	}
}
