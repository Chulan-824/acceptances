package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/Chulan-824/acceptances/contracts"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

var schemaOnce sync.Once
var compiled map[string]*jsonschema.Schema
var schemaError error

func loadSchemas() {
	compiled = map[string]*jsonschema.Schema{}
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	names := []string{"common", "definitions", "target", "plan", "report", "manifest", "evaluation", "snapshot"}
	for _, name := range names {
		raw, e := contracts.Schemas.ReadFile("schemas/" + name + ".json")
		if e != nil {
			schemaError = e
			return
		}
		value, e := Decode(raw)
		if e != nil {
			schemaError = e
			return
		}
		if e = c.AddResource("https://acceptances.local/schemas/"+name+".json", value); e != nil {
			schemaError = e
			return
		}
	}
	for _, name := range names[1:] {
		sch, e := c.Compile("https://acceptances.local/schemas/" + name + ".json")
		if e != nil {
			schemaError = e
			return
		}
		compiled[name] = sch
	}
}

// ValidateDocument validates structure, then local semantic invariants; raw bytes are never replaced.
func ValidateDocument(kind string, raw []byte) (map[string]any, error) {
	limit := DocumentLimit
	if kind == "manifest" {
		limit = ManifestLimit
	}
	if len(raw) > limit {
		return nil, Failure("LIMIT_EXCEEDED", "", "document too large")
	}
	value, err := Decode(raw)
	if err != nil {
		return nil, err
	}
	doc, ok := value.(map[string]any)
	if !ok {
		return nil, Failure("SCHEMA_INVALID", "", "document must be an object")
	}
	if version, ok := doc["schemaVersion"].(string); ok && version != SchemaVersion {
		return nil, Failure("UNSUPPORTED_VERSION", "/schemaVersion", "unsupported schema version")
	}
	schemaOnce.Do(loadSchemas)
	if schemaError != nil {
		return nil, fmt.Errorf("compile document contracts: %w", schemaError)
	}
	sch, ok := compiled[kind]
	if !ok {
		return nil, Failure("INVALID_ARGUMENT", "/kind", "unknown document kind")
	}
	if err = sch.Validate(value); err != nil {
		result := Failure("SCHEMA_INVALID", "", "document does not match schema")
		var ve *jsonschema.ValidationError
		if errors.As(err, &ve) {
			var visit func(*jsonschema.ValidationError)
			visit = func(e *jsonschema.ValidationError) {
				if len(e.Causes) > 0 {
					for _, child := range e.Causes {
						visit(child)
					}
					return
				}
				p := ""
				for _, part := range e.InstanceLocation {
					p = pointer(p, part)
				}
				result.Details = append(result.Details, Diagnostic{Code: "SCHEMA_INVALID", Pointer: p, Message: "schema constraint violated"})
			}
			result.Details = nil
			visit(ve)
		}
		return nil, result
	}
	extensionBytes := 0
	var extensions func(any)
	extensions = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, item := range x {
				if k == "extensions" {
					b, _ := json.Marshal(item)
					extensionBytes += len(b)
				} else {
					extensions(item)
				}
			}
		case []any:
			for _, item := range x {
				extensions(item)
			}
		}
	}
	extensions(doc)
	if extensionBytes > ExtensionLimit {
		return nil, Failure("LIMIT_EXCEEDED", "/extensions", "combined extensions exceed 64 KiB")
	}
	if err = validateSemantics(kind, doc); err != nil {
		return nil, err
	}
	return doc, nil
}
func field(m map[string]any, k string) string { v, _ := m[k].(string); return v }
func object(v any) map[string]any             { m, _ := v.(map[string]any); return m }
func array(v any) []any                       { a, _ := v.([]any); return a }
func number(v any) int64                      { n, _ := v.(json.Number); f, _ := n.Float64(); return int64(f) }
func unique(items []any, key, p string) error {
	seen := map[string]bool{}
	for i, item := range items {
		id := field(object(item), key)
		if seen[id] {
			return Failure("SCHEMA_INVALID", fmt.Sprintf("%s/%d/%s", p, i, key), "duplicate identity")
		}
		seen[id] = true
	}
	return nil
}
func validateSemantics(kind string, d map[string]any) error {
	switch kind {
	case "definitions":
		for _, k := range []string{"cases", "executionDefinitions", "suites", "moduleTags"} {
			if err := unique(array(d[k]), "id", "/"+k); err != nil {
				return err
			}
		}
		cases := map[string]map[string]any{}
		for i, v := range array(d["cases"]) {
			c := object(v)
			cases[field(c, "id")] = c
			if field(c, "ownerRepositoryId") != field(d, "repositoryId") {
				return Failure("REFERENCE_INVALID", fmt.Sprintf("/cases/%d/ownerRepositoryId", i), "case owner must be document repository")
			}
			if err := unique(array(c["checkItems"]), "id", fmt.Sprintf("/cases/%d/checkItems", i)); err != nil {
				return err
			}
		}
		for i, v := range array(d["executionDefinitions"]) {
			e := object(v)
			r := object(e["caseRef"])
			c := cases[field(r, "id")]
			if c == nil || field(c, "versionId") != field(r, "versionId") {
				return Failure("REFERENCE_INVALID", fmt.Sprintf("/executionDefinitions/%d/caseRef", i), "execution must reference a declared case version")
			}
			checks := map[string]bool{}
			for _, v := range array(c["checkItems"]) {
				checks[field(object(v), "id")] = true
			}
			for _, v := range array(e["evidenceRequirements"]) {
				if !checks[field(object(v), "checkItemId")] {
					return Failure("REFERENCE_INVALID", fmt.Sprintf("/executionDefinitions/%d/evidenceRequirements", i), "unknown check item")
				}
			}
			if script := object(e["scriptRef"]); script != nil {
				if err := ValidatePath(field(script, "path"), false); err != nil {
					return err
				}
			}
		}
		return ValidatePath(field(object(d["source"]), "definitionPath"), false)
	case "target":
		return unique(array(d["repositories"]), "repositoryId", "/repositories")
	case "plan":
		return unique(array(d["items"]), "id", "/items")
	case "manifest":
		assets := array(d["assets"])
		if err := unique(assets, "id", "/assets"); err != nil {
			return err
		}
		if err := unique(array(d["documents"]), "id", "/documents"); err != nil {
			return err
		}
		paths := map[string]bool{}
		var total int64
		previous := ""
		for i, v := range assets {
			a := object(v)
			p := field(a, "path")
			if err := ValidatePath(p, true); err != nil {
				return err
			}
			fold := FoldPath(p)
			if paths[fold] {
				return Failure("PATH_INVALID", fmt.Sprintf("/assets/%d/path", i), "case-folded path collision")
			}
			paths[fold] = true
			if i > 0 && p <= previous {
				return Failure("SCHEMA_INVALID", "/assets", "assets must be sorted by UTF-8 path")
			}
			previous = p
			size := number(a["size"])
			if size > 536870912 {
				return Failure("LIMIT_EXCEEDED", "/assets", "asset exceeds 512 MiB")
			}
			total += size
		}
		if total > 2147483648 {
			return Failure("LIMIT_EXCEEDED", "/assets", "revision assets exceed 2 GiB")
		}
		previous = ""
		for i, v := range array(d["documents"]) {
			a := object(v)
			sortKey := field(a, "kind") + "/" + field(a, "id")
			if i > 0 && sortKey <= previous {
				return Failure("SCHEMA_INVALID", "/documents", "documents must be sorted by kind/id")
			}
			previous = sortKey
		}
	case "report":
		if err := validateTime(field(d, "startedAt"), field(d, "endedAt"), "/endedAt"); err != nil {
			return err
		}
		if d["replacesRevisionId"] != nil && strings.TrimSpace(field(d, "correctionReason")) == "" {
			return Failure("SCHEMA_INVALID", "/correctionReason", "corrections require a reason")
		}
		if field(d, "replacesRevisionId") == field(d, "id") {
			return Failure("REFERENCE_INVALID", "/replacesRevisionId", "revision cannot replace itself")
		}
		for _, k := range []string{"id", "planItemId"} {
			if err := unique(array(d["results"]), k, "/results"); err != nil {
				return err
			}
		}
		if err := unique(array(d["sourceSnapshots"]), "repositoryId", "/sourceSnapshots"); err != nil {
			return err
		}
		for _, v := range array(d["sourceSnapshots"]) {
			s := object(v)
			if s["fingerprint"] == nil && s["complete"] == true {
				return Failure("SCHEMA_INVALID", "/sourceSnapshots", "missing fingerprint cannot be complete")
			}
		}
		observed := map[string]bool{}
		build := object(d["observedBuild"])
		if err := unique(array(build["observations"]), "id", "/observedBuild/observations"); err != nil {
			return err
		}
		for _, v := range array(build["observations"]) {
			observed[field(object(v), "id")] = true
		}
		for i, v := range array(d["results"]) {
			r := object(v)
			p := fmt.Sprintf("/results/%d", i)
			if r["actualObservedRef"] != nil && !observed[field(r, "actualObservedRef")] {
				return Failure("REFERENCE_INVALID", p+"/actualObservedRef", "unknown build observation")
			}
			attempts := array(r["attempts"])
			if err := unique(attempts, "id", p+"/attempts"); err != nil {
				return err
			}
			if len(attempts) == 0 {
				if field(r, "outcome") != "not-run" {
					return Failure("SCHEMA_INVALID", p+"/attempts", "executed result requires attempts")
				}
				continue
			}
			if field(r, "outcome") == "not-run" {
				return Failure("SCHEMA_INVALID", p+"/outcome", "not-run cannot contain attempts")
			}
			failed := false
			last := ""
			for j, v := range attempts {
				a := object(v)
				if number(a["ordinal"]) != int64(j+1) {
					return Failure("SCHEMA_INVALID", p+"/attempts", "attempt ordinals must be consecutive")
				}
				if err := validateTime(field(a, "startedAt"), field(a, "endedAt"), p+"/attempts"); err != nil {
					return err
				}
				last = field(a, "outcome")
				if j < len(attempts)-1 && last == "failed" {
					failed = true
				}
				if err := unique(array(a["observations"]), "checkItemId", p+"/attempts/observations"); err != nil {
					return err
				}
				for _, obs := range array(a["observations"]) {
					for _, ev := range array(object(obs)["evidence"]) {
						selector := object(object(ev)["selector"])
						if selector != nil {
							start, end := selector["startMs"], selector["endMs"]
							if start == nil {
								start, end = selector["lineStart"], selector["lineEnd"]
							}
							if number(start) > number(end) {
								return Failure("SCHEMA_INVALID", p+"/attempts", "selector end precedes start")
							}
						}
					}
				}
			}
			if last == "passed" && failed {
				last = "flaky"
			}
			if field(r, "outcome") != last {
				return Failure("SCHEMA_INVALID", p+"/outcome", "outcome disagrees with actual attempts")
			}
		}
	}
	return nil
}
