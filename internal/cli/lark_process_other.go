//go:build !unix

package cli

import (
	"os/exec"
	"time"
)

// shortcut: 非 Unix 仅取消直接子进程；支持该平台正式验收前需加入并验证进程树取消。
func configureLarkProcess(cmd *exec.Cmd) { cmd.WaitDelay = time.Second }
