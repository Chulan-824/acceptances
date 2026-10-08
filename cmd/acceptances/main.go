package main

import (
	"github.com/Chulan-824/acceptances/internal/cli"
	"os"
)

func main()                 { os.Exit(run(os.Args[1:])) }
func run(args []string) int { return cli.Run(args, os.Stdout, os.Stderr) }
