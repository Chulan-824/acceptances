package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/config"
	"github.com/Chulan-824/acceptances/internal/database"
	"github.com/Chulan-824/acceptances/internal/identity"
	"golang.org/x/term"
)

func manage(args []string) error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := database.Open(ctx, c.DatabaseURL)
	if err != nil {
		return err
	}
	defer store.Close()
	if args[0] == "migrate" {
		if len(args) != 2 || args[1] != "up" {
			return fmt.Errorf("usage: server migrate up")
		}
		if err = store.Migrate(ctx); err != nil {
			return err
		}
		fmt.Println("database migrations complete")
		return nil
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	input := flags.String("input", "", "absolute restricted JSON file with username/password")
	revoke := flags.Bool("revoke-tokens", false, "revoke machine tokens during password reset")
	if err = flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments")
	}
	var credentials struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if *input != "" {
		info, err := os.Stat(*input)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 4096 {
			return fmt.Errorf("input must be a restricted regular file, mode 600 or stricter")
		}
		if !strings.HasPrefix(*input, "/") {
			return fmt.Errorf("input path must be absolute")
		}
		raw, err := os.ReadFile(*input)
		if err != nil {
			return fmt.Errorf("input unavailable")
		}
		d := json.NewDecoder(strings.NewReader(string(raw)))
		d.DisallowUnknownFields()
		if err = d.Decode(&credentials); err != nil {
			return fmt.Errorf("input JSON invalid")
		}
	} else {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return fmt.Errorf("interactive terminal or --input required")
		}
		if args[0] == "init-owner" {
			fmt.Print("Username: ")
			name, err := bufio.NewReader(os.Stdin).ReadString('\n')
			if err != nil {
				return err
			}
			credentials.Username = strings.TrimSpace(name)
		}
		fmt.Print("Password: ")
		raw, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		if err != nil {
			return err
		}
		credentials.Password = string(raw)
	}
	auth := identity.Auth{Store: store}
	if args[0] == "init-owner" {
		err = auth.InitOwner(ctx, credentials.Username, credentials.Password)
	} else {
		err = auth.ResetPassword(ctx, credentials.Password, *revoke)
	}
	if err != nil {
		return err
	}
	fmt.Println("owner credentials updated")
	return nil
}
