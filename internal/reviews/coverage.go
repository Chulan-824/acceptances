package reviews

import (
	"github.com/Chulan-824/acceptances/internal/protocol"
	"sort"
)

type Candidate struct {
	AssetKinds                                        map[string]string
	IntegrityInvalid                                  bool
	RunID, RevisionID, ResultID, PlanItemID, TargetID string
	Replaces                                          *string
	Report, Result, Evaluation                        map[string]any
	EvaluationID, EvaluationSHA                       string
	Initial                                           bool
}
type Selection struct {
	ID, ItemID, Digest string
	ResultRef          map[string]any
}

func (c Candidate) Ref() map[string]any {
	return map[string]any{"runId": c.RunID, "revisionId": c.RevisionID, "resultId": c.ResultID}
}
func refKey(ref map[string]any) string {
	return str(ref, "runId") + "/" + str(ref, "revisionId") + "/" + str(ref, "resultId")
}
func CandidateDigest(candidates []Candidate) string {
	refs := []any{}
	for _, c := range candidates {
		refs = append(refs, c.Ref())
	}
	sort.Slice(refs, func(i, j int) bool { return refKey(obj(refs[i])) < refKey(obj(refs[j])) })
	raw, _ := protocol.Canonical(refs)
	return protocol.Digest(raw)
}

// Snapshot uses explicit revision and execution predecessor edges; timestamps never select winners.
func Snapshot(project, campaign string, plan, target map[string]any, candidates []Candidate, selections []Selection, adopted []any) map[string]any {
	replaced := map[string]bool{}
	for _, c := range candidates {
		if c.Replaces != nil {
			replaced[c.RunID+"/"+*c.Replaces] = true
		}
	}
	items := []any{}
	ready := true
	selectionRefs := []string{}
	for _, v := range arr(plan["items"]) {
		item := obj(v)
		id := str(item, "id")
		matching := []Candidate{}
		suppressed := map[string]bool{}
		for _, c := range candidates {
			if replaced[c.RunID+"/"+c.RevisionID] || c.TargetID != str(target, "id") || c.PlanItemID != id || !equal(c.Result["caseRef"], map[string]any{"id": str(obj(item["caseRef"]), "id"), "versionId": str(obj(item["caseRef"]), "versionId")}) || !equal(c.Result["executionRef"], map[string]any{"id": str(obj(item["executionRef"]), "id"), "versionId": str(obj(item["executionRef"]), "versionId")}) {
				continue
			}
			matching = append(matching, c)
			for _, v := range arr(c.Result["supersedes"]) {
				suppressed[refKey(obj(v))] = true
			}
		}
		leaves := []Candidate{}
		for _, c := range matching {
			if !suppressed[refKey(c.Ref())] {
				leaves = append(leaves, c)
			}
		}
		result := map[string]any{"planItemId": id, "required": item["required"], "selectionStatus": "missing", "resultRef": nil, "evaluationRef": nil, "eligibility": false, "codes": []string{"MISSING_RESULT"}}
		var chosen *Candidate
		if len(leaves) == 1 {
			chosen = &leaves[0]
		} else if len(leaves) > 1 {
			digest := CandidateDigest(leaves)
			for i := len(selections) - 1; i >= 0; i-- {
				selection := selections[i]
				if selection.ItemID != id || selection.Digest != digest {
					continue
				}
				for j := range leaves {
					if refKey(leaves[j].Ref()) == refKey(selection.ResultRef) {
						chosen = &leaves[j]
						selectionRefs = append(selectionRefs, selection.ID)
						break
					}
				}
				break
			}
			if chosen == nil {
				refs := []any{}
				for _, c := range leaves {
					refs = append(refs, c.Ref())
				}
				sort.Slice(refs, func(i, j int) bool { return refKey(obj(refs[i])) < refKey(obj(refs[j])) })
				result["selectionStatus"] = "conflict"
				result["candidateRefs"] = refs
				result["codes"] = []string{"RESULT_CONFLICT"}
			}
		}
		if chosen != nil {
			result["selectionStatus"] = "selected"
			result["resultRef"] = chosen.Ref()
			result["evaluationRef"] = map[string]any{"id": chosen.EvaluationID, "sha256": chosen.EvaluationSHA, "rulesetVersion": protocol.RulesetVersion}
			eligible := false
			codes := []string{}
			for _, v := range arr(chosen.Evaluation["results"]) {
				e := obj(v)
				if str(e, "resultId") != chosen.ResultID {
					continue
				}
				eligible = e["eligible"] == true
				for _, v := range arr(e["checks"]) {
					check := obj(v)
					for _, code := range arr(check["codes"]) {
						codes = append(codes, code.(string))
					}
				}
			}
			for _, v := range arr(chosen.Evaluation["diagnostics"]) {
				d := obj(v)
				if str(d, "resourceId") == chosen.ResultID {
					codes = append(codes, str(d, "code"))
				}
			}
			for key, value := range obj(item["environmentRequirements"]) {
				requirement := obj(value)
				actual, _ := obj(chosen.Report["environment"])[key].(string)
				matches := false
				if str(requirement, "op") == "eq" {
					matches = actual == str(requirement, "value")
				} else {
					for _, allowed := range arr(requirement["stringValues"]) {
						if allowed == actual {
							matches = true
						}
					}
				}
				if !matches {
					eligible = false
					codes = append(codes, "ENVIRONMENT_MISMATCH")
				}
			}
			for _, v := range arr(item["evidenceRequirements"]) {
				requirement := obj(v)
				checkID := str(requirement, "checkItemId")
				satisfied := false
				for _, v := range arr(chosen.Evaluation["results"]) {
					evaluationResult := obj(v)
					if str(evaluationResult, "resultId") != chosen.ResultID {
						continue
					}
					for _, v := range arr(evaluationResult["checks"]) {
						check := obj(v)
						validCount := 0
						for _, asset := range arr(check["assetIds"]) {
							id, _ := asset.(string)
							for _, kind := range arr(requirement["allowedKinds"]) {
								if kind == chosen.AssetKinds[id] {
									validCount++
									break
								}
							}
						}
						if str(check, "checkItemId") == checkID && str(check, "status") == "satisfied" && validCount >= num(requirement["minCount"]) {
							satisfied = true
						}
					}
				}
				if !satisfied {
					eligible = false
					codes = append(codes, "EVIDENCE_INSUFFICIENT")
				}
			}
			if str(chosen.Result, "outcome") != "passed" {
				eligible = false
			}
			if chosen.IntegrityInvalid {
				eligible = false
				codes = append(codes, "INTEGRITY_INVALID")
			}
			result["eligibility"] = eligible
			result["codes"] = codes
		}
		if item["required"] == true && result["eligibility"] != true {
			ready = false
		}
		items = append(items, result)
	}
	sort.Slice(items, func(i, j int) bool { return str(obj(items[i]), "planItemId") < str(obj(items[j]), "planItemId") })
	sort.Strings(selectionRefs)
	sort.Slice(adopted, func(i, j int) bool { return str(obj(adopted[i]), "id") < str(obj(adopted[j]), "id") })
	state := "not_ready"
	if ready {
		state = "ready"
	}
	return map[string]any{"schemaVersion": protocol.SchemaVersion, "kind": "acceptance_snapshot", "projectId": project, "campaignId": campaign, "planRef": map[string]any{"id": str(plan, "id"), "sha256": plan["documentSha256"]}, "targetRef": map[string]any{"id": str(target, "id"), "sha256": target["documentSha256"]}, "items": items, "readiness": state, "selectionRefs": selectionRefs, "adoptedEvaluationRefs": adopted}
}
