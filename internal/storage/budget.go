package storage

import (
	"github.com/Chulan-824/acceptances/internal/protocol"
	"golang.org/x/sys/unix"
	"sync"
)

var budgetMu sync.Mutex
var reserved int64
var uploads = make(chan struct{}, 2)

func reserve(dir string, size int64) (func(), error) {
	select {
	case uploads <- struct{}{}:
	default:
		return nil, protocol.Failure("INSUFFICIENT_SPACE", "", "storage write concurrency limit reached")
	}
	budgetMu.Lock()
	defer budgetMu.Unlock()
	var stat unix.Statfs_t
	if err := unix.Statfs(dir, &stat); err != nil {
		<-uploads
		return nil, protocol.Failure("STORAGE_UNAVAILABLE", "", "cannot inspect local storage capacity")
	}
	available := int64(stat.Bavail) * int64(stat.Bsize)
	need := size * 2
	if available-reserved-need < 2<<30 {
		<-uploads
		return nil, protocol.Failure("INSUFFICIENT_SPACE", "", "storage reserve would fall below 2 GiB")
	}
	reserved += need
	return func() { budgetMu.Lock(); reserved -= need; budgetMu.Unlock(); <-uploads }, nil
}
