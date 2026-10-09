package cli

import (
	"bytes"
	"encoding/json"
	"flag"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/Chulan-824/acceptances/internal/protocol"
)

// fingerprint exposes the existing protocol collector; it does not infer deployed build identity.
func fingerprint(args []string, log io.Writer) (any, error) {
	flags := flag.NewFlagSet("fingerprint", flag.ContinueOnError)
	flags.SetOutput(log)
	repo := flags.String("repo", "", "working tree path")
	repository := flags.String("repository", "", "repository UUID")
	base := flags.String("base", "", "full baseline commit")
	scopeFile := flags.String("scope", "", "JSON scope file")
	flags.Bool("json", false, "JSON output")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 || *repo == "" || *scopeFile == "" {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "repo, repository, base and scope required")
	}
	if strings.HasPrefix(strings.ToLower(filepath.Base(*scopeFile)), ".env") {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "scope cannot be a secret file")
	}
	raw, err := os.ReadFile(*scopeFile)
	if err != nil {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "scope file unavailable")
	}
	if _, err = protocol.Decode(raw); err != nil {
		return nil, err
	}
	var scope protocol.Scope
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&scope); err != nil || scope.Include == nil || scope.Exclude == nil || scope.MissingInputs == nil {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "invalid scope")
	}
	manifest, digest, err := protocol.CollectFingerprint(*repo, *repository, *base, scope)
	if err != nil {
		return nil, err
	}
	scopeRaw, err := protocol.Canonical(manifest.Scope)
	if err != nil {
		return nil, err
	}
	return map[string]any{"manifest": manifest, "fingerprint": digest, "scopeDigest": protocol.Digest(scopeRaw)}, nil
}
