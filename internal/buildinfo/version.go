package buildinfo

var Version = "0.1.0-dev.1"
var Commit = "unknown"

type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	Phase   string `json:"phase"`
}

func Current() Info { return Info{Version: Version, Commit: Commit, Phase: "local-v1"} }
