package api

import (
	"fmt"
	"os"
	"sync"
)

// The OS lock protects local files independently of a MySQL connection. Its
// final reference belongs to the last request, including its deferred cleanup.
type archiveDirectory struct {
	mu      sync.Mutex
	file    *os.File
	refs    int
	closing bool
}

func lockArchiveDirectory(dir string) (*archiveDirectory, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	file, err := os.Open(dir)
	if err != nil {
		return nil, err
	}
	if err = lockDirectoryFile(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("archive directory is already in use or cannot be locked: %w", err)
	}
	return &archiveDirectory{file: file, refs: 1}, nil
}

func (d *archiveDirectory) retain() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closing {
		return false
	}
	d.refs++
	return true
}

func (d *archiveDirectory) stop() {
	d.mu.Lock()
	d.closing = true
	d.mu.Unlock()
}

func (d *archiveDirectory) release() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.refs--
	if d.refs == 0 && d.file != nil {
		return d.file.Close() // Closing the descriptor releases the OS lock.
	}
	return nil
}
