package reviews

import (
	"encoding/json"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"time"
)

func obj(v any) map[string]any              { m, _ := v.(map[string]any); return m }
func arr(v any) []any                       { a, _ := v.([]any); return a }
func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func num(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case json.Number:
		f, _ := n.Float64()
		return int(f)
	}
	return 0
}
func equal(a, b any) bool {
	x, _ := protocol.Canonical(a)
	y, _ := protocol.Canonical(b)
	return string(x) == string(y)
}

// Evaluate never trusts producer outcome as the readiness verdict.
func Evaluate(project, revision, run, reportSha, manifestSha string, report, plan, target map[string]any, checks map[string][]any, requirements map[string][]any, assets map[string]string) map[string]any {
	identity := "matched"
	build := obj(report["observedBuild"])
	if str(build, "status") == "mismatched" {
		identity = "mismatched"
	}
	observed := map[string]any{}
	for _, v := range arr(build["repositories"]) {
		m := obj(v)
		observed[str(m, "repositoryId")] = m["revision"]
	}
	for _, v := range arr(target["repositories"]) {
		m := obj(v)
		actual := observed[str(m, "repositoryId")]
		if actual == nil {
			if identity != "mismatched" {
				identity = "unverified"
			}
		} else if !equal(actual, m["revision"]) {
			identity = "mismatched"
		}
		rev := obj(m["revision"])
		if str(rev, "kind") == "dirty" && rev["complete"] != true && identity != "mismatched" {
			identity = "unverified"
		}
	}
	if len(arr(build["observations"])) == 0 && identity != "mismatched" {
		identity = "unverified"
	}
	if str(build, "status") == "unverified" && identity != "mismatched" {
		identity = "unverified"
	}
	planItems := map[string]map[string]any{}
	for _, v := range arr(plan["items"]) {
		m := obj(v)
		planItems[str(m, "id")] = m
	}
	resultEvaluations := []any{}
	diagnostics := []any{}
	for _, v := range arr(report["results"]) {
		r := obj(v)
		item := planItems[str(r, "planItemId")]
		codes := []string{}
		eligible := str(r, "outcome") == "passed"
		if !eligible {
			codes = append(codes, "FAILED")
			if str(r, "outcome") == "flaky" {
				codes = []string{"FLAKY"}
			}
		}
		resultIdentity := identity
		evidenceBuild := false
		for _, v := range arr(build["observations"]) {
			o := obj(v)
			if str(o, "id") == str(r, "actualObservedRef") && len(arr(o["assetIds"])) > 0 {
				evidenceBuild = true
				for _, a := range arr(o["assetIds"]) {
					id, _ := a.(string)
					if _, ok := assets[id]; !ok {
						evidenceBuild = false
					}
				}
			}
		}
		if !evidenceBuild && resultIdentity != "mismatched" {
			resultIdentity = "unverified"
		}
		for _, v := range arr(build["changes"]) {
			change := obj(v)
			for _, id := range arr(change["affectedResultIds"]) {
				if id == str(r, "id") {
					resultIdentity = "mismatched"
				}
			}
		}
		if resultIdentity != "matched" {
			eligible = false
			code := "IDENTITY_UNVERIFIED"
			if resultIdentity == "mismatched" {
				code = "IDENTITY_MISMATCH"
			}
			codes = append(codes, code)
		}
		for key, v := range obj(item["environmentRequirements"]) {
			req := obj(v)
			actual, _ := obj(report["environment"])[key].(string)
			match := false
			if str(req, "op") == "eq" {
				match = actual == str(req, "value")
			} else {
				for _, allowed := range arr(req["stringValues"]) {
					if allowed == actual {
						match = true
					}
				}
			}
			if !match {
				eligible = false
				codes = append(codes, "ENVIRONMENT_MISMATCH")
			}
		}
		lastObservations := map[string]map[string]any{}
		attempts := arr(r["attempts"])
		if len(attempts) > 0 {
			for _, v := range arr(obj(attempts[len(attempts)-1])["observations"]) {
				m := obj(v)
				lastObservations[str(m, "checkItemId")] = m
			}
		}
		required := map[string]map[string]any{}
		for _, v := range requirements[str(item, "id")] {
			m := obj(v)
			required[str(m, "checkItemId")] = m
		}
		for _, v := range arr(item["evidenceRequirements"]) {
			m := obj(v)
			key := str(m, "checkItemId")
			b := required[key]
			if b != nil {
				allowed := []any{}
				for _, kind := range arr(m["allowedKinds"]) {
					for _, base := range arr(b["allowedKinds"]) {
						if kind == base {
							allowed = append(allowed, kind)
						}
					}
				}
				count := num(m["minCount"])
				if num(b["minCount"]) > count {
					count = num(b["minCount"])
				}
				required[key] = map[string]any{"checkItemId": key, "allowedKinds": allowed, "minCount": count}
			} else {
				required[key] = m
			}
		}
		checkEvaluations := []any{}
		for _, v := range checks[str(item, "id")] {
			check := obj(v)
			id := str(check, "id")
			o := lastObservations[id]
			status := "satisfied"
			checkCodes := []string{}
			validAssets := []string{}
			if o == nil || str(o, "verdict") == "unknown" {
				status = "unknown"
				checkCodes = append(checkCodes, "EVIDENCE_INSUFFICIENT")
			} else if str(o, "verdict") != "passed" {
				status = "unsatisfied"
				checkCodes = append(checkCodes, "FAILED")
			}
			requirement := required[id]
			seen := map[string]bool{}
			for _, v := range arr(o["evidence"]) {
				e := obj(v)
				assetID := str(e, "assetId")
				kind, ok := assets[assetID]
				allowed := requirement == nil
				for _, k := range arr(requirement["allowedKinds"]) {
					if k == kind {
						allowed = true
					}
				}
				if ok && allowed && !seen[assetID] {
					validAssets = append(validAssets, assetID)
					seen[assetID] = true
				}
			}
			if len(validAssets) < num(requirement["minCount"]) {
				status = "unsatisfied"
				checkCodes = append(checkCodes, "EVIDENCE_INSUFFICIENT")
			}
			if status != "satisfied" {
				eligible = false
			}
			checkEvaluations = append(checkEvaluations, map[string]any{"checkItemId": id, "status": status, "codes": checkCodes, "assetIds": validAssets})
		}
		for _, code := range codes {
			diagnostics = append(diagnostics, map[string]any{"code": code, "resourceId": str(r, "id"), "message": code})
		}
		resultEvaluations = append(resultEvaluations, map[string]any{"resultId": str(r, "id"), "outcome": str(r, "outcome"), "eligible": eligible, "checks": checkEvaluations})
	}
	return map[string]any{"schemaVersion": protocol.SchemaVersion, "kind": "evaluation", "id": protocol.NewID(), "projectId": project, "revisionRef": map[string]any{"runId": run, "revisionId": revision, "reportSha256": reportSha, "manifestSha256": manifestSha}, "rulesetVersion": protocol.RulesetVersion, "evaluatedAt": time.Now().UTC().Format(time.RFC3339Nano), "identityStatus": identity, "results": resultEvaluations, "diagnostics": diagnostics}
}
