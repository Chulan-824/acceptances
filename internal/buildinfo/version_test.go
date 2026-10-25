package buildinfo

import "testing"

func TestCurrentBuildIdentity(t *testing.T) {
	commit, dirty, digest := Commit, Dirty, SourceDigest
	t.Cleanup(func() { Commit, Dirty, SourceDigest = commit, dirty, digest })
	Commit, Dirty, SourceDigest = "candidate", "true", "source-sha"
	info := Current()
	if info.Commit != Commit || info.Dirty == nil || !*info.Dirty || info.SourceDigest != SourceDigest {
		t.Fatalf("build identity = %+v", info)
	}
	Dirty = "false"
	if info = Current(); info.Dirty == nil || *info.Dirty {
		t.Fatalf("clean identity = %+v", info)
	}
	Dirty = "invalid"
	if Current().Dirty != nil {
		t.Fatal("unknown dirty must not be reported as clean")
	}
}
