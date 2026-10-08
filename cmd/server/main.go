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

	"github.com/Chulan-824/acceptances/internal/httpserver"
)

func main() {
	if err := run(); err != nil {
		slog.Error("服务退出", "error", err)
		os.Exit(1)
	}
}

func run() error {
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
		return fmt.Errorf("基础阶段不支持管理子命令")
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
	server := &http.Server{Handler: httpserver.New(web), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	slog.Info("基础服务已启动，业务尚未就绪", "address", listener.Addr().String())
	select {
	case err := <-result:
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
		return nil
	}
}
