package buildinfo

import (
	"runtime/debug"
	"strconv"
)

var Version = "0.1.0-dev.1"
var Commit = "unknown"
var Dirty = "unknown"
var SourceDigest = "unknown"

type Info struct {
	Version      string `json:"version"`
	Commit       string `json:"commit"`
	Phase        string `json:"phase"`
	Dirty        *bool  `json:"dirty"`
	SourceDigest string `json:"sourceDigest"`
}

func Current() Info {
	info := Info{Version: Version, Commit: Commit, Phase: "local-v1", SourceDigest: SourceDigest}
	dirty := Dirty
	if built, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range built.Settings {
			if info.Commit == "unknown" && setting.Key == "vcs.revision" {
				info.Commit = setting.Value
			}
			if dirty == "unknown" && setting.Key == "vcs.modified" {
				dirty = setting.Value
			}
		}
	}
	if value, err := strconv.ParseBool(dirty); err == nil {
		info.Dirty = new(value)
	}
	return info
}
