package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/Chulan-824/acceptances/internal/buildinfo"
)

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	if len(args) == 0 || (len(args) == 1 && (args[0] == "help" || args[0] == "--help")) {
		fmt.Println("acceptances version [--json]\n基础阶段：业务命令尚未接入。")
		return 0
	}
	if args[0] == "version" && (len(args) == 1 || (len(args) == 2 && args[1] == "--json")) {
		if len(args) == 2 {
			_ = json.NewEncoder(os.Stdout).Encode(buildinfo.Current())
		} else {
			fmt.Println(buildinfo.Current().Version)
		}
		return 0
	}
	fmt.Fprintln(os.Stderr, "基础阶段仅支持 version [--json] 和 --help")
	return 2
}
