package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalGolden(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/fixtures/jcs-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Input     string `json:"input"`
		Canonical string `json:"canonical"`
		SHA256    string `json:"sha256"`
	}
	if err = json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, v := range vectors {
		value, err := Decode([]byte(v.Input))
		if err != nil {
			t.Fatal(err)
		}
		got, err := Canonical(value)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != v.Canonical || Digest(got) != v.SHA256 {
			t.Fatalf("canonical mismatch: input=%s got=%s want=%s", v.Input, got, v.Canonical)
		}
	}
	if Digest([]byte("{}")) == Digest([]byte("{}\n")) {
		t.Fatal("raw whitespace must change digest")
	}
}
func TestStrictJSON(t *testing.T) {
	for _, raw := range []string{`{"a":1,"a":2}`, `{"a":{"b":1,"b":2}}`, `{"s":"\ud800"}`, `{"s":"\udc00"}`, `{} {}`, `{"n":1e400}`, "\xef\xbb\xbf{}", string([]byte{'"', 0xff, '"'})} {
		if _, err := Decode([]byte(raw)); err == nil {
			t.Errorf("accepted invalid input %q", raw)
		}
	}
	if _, err := Decode([]byte(`{"s":"\ud83d\ude00"}`)); err != nil {
		t.Fatal(err)
	}
}
func TestDocumentContracts(t *testing.T) {
	bundle, err := LoadBundle("../../contracts/fixtures/failed-bundle")
	if err != nil {
		t.Fatal(err)
	}
	if field(bundle.Report.Value, "runId") == "" || len(bundle.RequiresServerChecks) == 0 {
		t.Fatal("bundle lost stable identity or server checks")
	}
	for _, change := range []func(map[string]any){func(d map[string]any) { d["unknownField"] = true }, func(d map[string]any) { d["projectId"] = nil }, func(d map[string]any) { d["runId"] = "latest" }, func(d map[string]any) { object(array(d["results"])[0])["outcome"] = "passed" }} {
		doc, err := Decode(bundle.Report.Raw)
		if err != nil {
			t.Fatal(err)
		}
		change(object(doc))
		raw, err := json.Marshal(doc)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = ValidateDocument("report", raw); err == nil {
			t.Fatal("accepted invalid report")
		}
	}
}
func TestPathRules(t *testing.T) {
	for _, name := range []string{"../assets/x", "/assets/x", "assets//x", "assets/./x", "assets/../x", "assets\\x", "assets/C:x", "assets/e\u0301.txt", "assets/a\n.txt"} {
		if ValidatePath(name, true) == nil {
			t.Errorf("accepted %q", name)
		}
	}
	if ValidatePath("assets/é.txt", true) != nil {
		t.Fatal("NFC path rejected")
	}
	if FoldPath("assets/Straße") != FoldPath("assets/STRASSE") {
		t.Fatal("Unicode case folding mismatch")
	}
}
func TestBundleEscapeAndMissingAssets(t *testing.T) {
	src := "../../contracts/fixtures/failed-bundle"
	dir := t.TempDir()
	err := filepath.WalkDir(src, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, name)
		if err != nil {
			return err
		}
		dst := filepath.Join(dir, rel)
		if entry.IsDir() {
			return os.MkdirAll(dst, 0700)
		}
		raw, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, raw, 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	asset := filepath.Join(dir, "assets", "observation.txt")
	if err = os.Remove(asset); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadBundle(dir); err == nil {
		t.Fatal("accepted missing declared asset")
	}
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err = os.WriteFile(outside, []byte(strings.Repeat("x", 100)), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, asset); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadBundle(dir); err == nil {
		t.Fatal("accepted escaping asset symlink")
	}
}

func TestTypedIntegerSpellings(t *testing.T) {
	for _, raw := range []string{"1", "1.0", "1e0"} {
		var integer JSONInteger
		if err := json.Unmarshal([]byte(raw), &integer); err != nil || integer != 1 {
			t.Errorf("valid schema integer %s rejected: %v", raw, err)
		}
	}
	for _, raw := range []string{"1.5", "9007199254740992", "\"1\""} {
		var integer JSONInteger
		if json.Unmarshal([]byte(raw), &integer) == nil {
			t.Errorf("invalid protocol integer %s accepted", raw)
		}
	}
}

func TestCanonicalBinary64RoundTrip(t *testing.T) {
	// JCS numbers use binary64; safe integer limits belong to size/count fields.
	value, err := Decode([]byte(`{"example.number":1e20}`))
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := Canonical(value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Decode(canonical); err != nil {
		t.Fatalf("canonical output cannot be decoded: %s: %v", canonical, err)
	}
}

func TestDiagnosticRetryPolicy(t *testing.T) {
	for _, code := range []string{"RATE_LIMITED", "STORAGE_UNAVAILABLE", "INSUFFICIENT_SPACE", "MAINTENANCE", "BASIS_PENDING", "WAIT_TIMEOUT"} {
		err := Failure(code, "", "retry after querying status")
		if !err.Retryable || err.ExitCode() != 5 {
			t.Errorf("%s lost retry diagnostics", code)
		}
	}
	for _, code := range []string{"AUTH_EXPIRED", "DIGEST_MISMATCH", "INTERNAL_ERROR"} {
		if Failure(code, "", "requires intervention").Retryable {
			t.Errorf("%s must not invite automatic retries", code)
		}
	}
}
