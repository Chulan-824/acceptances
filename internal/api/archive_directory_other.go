//go:build !unix

package api

import (
	"fmt"
	"os"
)

func lockDirectoryFile(*os.File) error {
	return fmt.Errorf("archive directory locking requires a Unix host")
}
