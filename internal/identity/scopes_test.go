package identity

import "testing"

func TestRepositoryWriteScope(t *testing.T) {
	p := Principal{ProjectID: "project-a", Scopes: []string{"repositories:write", "results:read"}}
	if err := p.Require("project-a", "repositories:write"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ project, scope string }{
		{"project-b", "repositories:write"}, {"", "repositories:write"},
		{"project-a", "OWNER"}, {"project-a", "runs:write"},
	} {
		if p.Require(test.project, test.scope) == nil {
			t.Errorf("unexpected permission: %v", test)
		}
	}
	p.Scopes = []string{"results:read"}
	if p.Require("project-a", "repositories:write") == nil {
		t.Fatal("read scope allows repository registration")
	}
}
