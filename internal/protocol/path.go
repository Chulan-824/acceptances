package protocol

import (
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
	"strings"
	"time"
	"unicode"
)

func FoldPath(value string) string { return cases.Fold().String(value) }
func ValidatePath(value string, asset bool) error {
	if value == "" || strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\\:") || !norm.NFC.IsNormalString(value) {
		return Failure("PATH_INVALID", "/path", "expected a relative NFC POSIX path")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return Failure("PATH_INVALID", "/path", "control character in path")
		}
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return Failure("PATH_INVALID", "/path", "empty or traversal path segment")
		}
	}
	if asset && !strings.HasPrefix(value, "assets/") {
		return Failure("PATH_INVALID", "/path", "asset path must be under assets/")
	}
	return nil
}
func validateTime(start, end, p string) error {
	a, e := time.Parse(time.RFC3339Nano, start)
	if e != nil {
		return Failure("SCHEMA_INVALID", p, "invalid start time")
	}
	b, e := time.Parse(time.RFC3339Nano, end)
	if e != nil || b.Before(a) {
		return Failure("SCHEMA_INVALID", p, "end time precedes start time")
	}
	return nil
}
