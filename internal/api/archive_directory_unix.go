//go:build unix

package api

import (
	"os"
	"syscall"
)

func lockDirectoryFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}
