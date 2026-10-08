package protocol

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
)

func HashFile(file *os.File, max int64) (int64, string, error) {
	before, err := file.Stat()
	if err != nil {
		return 0, "", err
	}
	if !before.Mode().IsRegular() {
		return 0, "", Failure("PATH_INVALID", "", "asset must be a regular file")
	}
	if before.Size() > max {
		return 0, "", Failure("LIMIT_EXCEEDED", "", "asset exceeds declared size")
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(file, max+1))
	if err != nil {
		return 0, "", err
	}
	after, err := file.Stat()
	if err != nil {
		return 0, "", err
	}
	if n != before.Size() || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return 0, "", Failure("DIGEST_MISMATCH", "", "file changed while collecting evidence")
	}
	return n, hex.EncodeToString(h.Sum(nil)), nil
}
