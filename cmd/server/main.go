package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/config"
	"github.com/Chulan-824/acceptances/internal/database"
	"github.com/Chulan-824/acceptances/internal/httpserver"
	"github.com/Chulan-824/acceptances/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("服务退出", "error", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 && (os.Args[1] == "migrate" || os.Args[1] == "init-owner" || os.Args[1] == "reset-password") {
		return manage(os.Args[1:])
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	var business *api.Server
	if c.DatabaseURL != "" {
		store, err := database.Open(context.Background(), c.DatabaseURL)
		if err != nil {
			return err
		}
		defer store.Close()
		if err = os.MkdirAll(c.DataDir, 0700); err != nil {
			return fmt.Errorf("data directory unavailable")
		}
		business = api.New(store, c)
		local, err := storage.Open(c.DataDir, store)
		if err != nil {
			return err
		}
		defer local.Close()
		business.Storage = local
	}
	listen := os.Getenv("ACCEPTANCES_LISTEN")
	if listen == "" {
		listen = "127.0.0.1:8765"
	}
	flags := flag.NewFlagSet("server", flag.ContinueOnError)
	flags.StringVar(&listen, "listen", listen, "监听地址")
	webDir := flags.String("web-dir", "apps/web/dist", "Web 构建目录，空值禁用页面")
	if err := flags.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("未知管理子命令")
	}
	var web fs.FS
	if *webDir != "" {
		root, err := httpserver.WebRoot(*webDir)
		if err != nil {
			return fmt.Errorf("打开 Web 构建目录: %w", err)
		}
		defer root.Close()
		web = root.FS()
		if _, err := fs.Stat(web, "index.html"); err != nil {
			return fmt.Errorf("缺少 Web 构建产物: %w", err)
		}
	}
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return fmt.Errorf("监听服务: %w", err)
	}
	defer listener.Close()
	server := &http.Server{Handler: httpserver.New(web, business), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	workerDone := make(chan struct{})
	if business != nil {
		go func() { defer close(workerDone); business.Work(ctx) }()
	} else {
		close(workerDone)
	}
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	slog.Info("服务已启动，请检查 readiness 和初始化状态", "address", listener.Addr().String())
	select {
	case err := <-result:
		stop()
		select {
		case <-workerDone:
		case <-time.After(5 * time.Second):
			return fmt.Errorf("worker shutdown deadline exceeded; pending leases remain recoverable")
		}
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		deadline, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(deadline); err != nil {
			_ = server.Close()
			return fmt.Errorf("停止服务: %w", err)
		}
		select {
		case <-workerDone:
			return nil
		case <-deadline.Done():
			return fmt.Errorf("worker shutdown deadline exceeded; pending leases remain recoverable")
		}
	}
}
