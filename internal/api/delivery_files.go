package api

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (s *Server) copyDeliveryEvidence(runID, stage string, files []ArchivedFile) error {
	root, err := os.OpenRoot(filepath.Join(s.dir, "evidence", runID))
	if err != nil {
		return err
	}
	defer root.Close()
	target := filepath.Join(stage, "evidence")
	if err := os.Mkdir(target, 0700); err != nil {
		return err
	}
	for _, item := range files {
		if err := copyVerifiedFile(root, target, item); err != nil {
			return err
		}
	}
	if err := syncDirectory(target); err != nil {
		return err
	}
	return syncDirectory(stage)
}

func copyVerifiedFile(root *os.Root, target string, item ArchivedFile) error {
	if !validName(item.Path) {
		return fmt.Errorf("invalid archived filename")
	}
	input, err := root.Open(item.Path)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(filepath.Join(target, item.Path), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(output, hash), input)
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if size != item.Size || hex.EncodeToString(hash.Sum(nil)) != item.SHA256 {
		return fmt.Errorf("evidence changed while freezing: %s", item.Path)
	}
	return nil
}
