package cli

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestOfflineValidation(t *testing.T) {
	var out, log bytes.Buffer
	exit := Run([]string{"validate", "../../contracts/fixtures/failed-bundle", "--json"}, &out, &log)
	if exit != 0 {
		t.Fatalf("offline failed business report must remain structurally valid: %s", out.String())
	}
	var result map[string]any
	if json.Unmarshal(out.Bytes(), &result) != nil || result["valid"] != true {
		t.Fatal("stdout must contain one JSON result")
	}
}
func TestArgumentExitCodes(t *testing.T) {
	for _, args := range [][]string{{"unknown"}, {"check", "--project", "latest"}, {"validate"}} {
		var out, log bytes.Buffer
		if exit := Run(args, &out, &log); exit != 2 {
			t.Errorf("arguments %v exit=%d", args, exit)
		}
	}
}
