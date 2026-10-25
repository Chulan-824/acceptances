package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/httpserver"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
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
	dir := os.Getenv("ACCEPTANCES_DATA_DIR")
	if dir == "" {
		dir = "data"
	}
	flags := flag.NewFlagSet("server", flag.ContinueOnError)
	driver := os.Getenv("ACCEPTANCES_DB_DRIVER")
	dsnFile := os.Getenv("ACCEPTANCES_MYSQL_DSN_FILE")
	dsn := os.Getenv("ACCEPTANCES_MYSQL_DSN")
	if driver == "" {
		driver = "mysql"
	}
	flags.StringVar(&driver, "database", driver, "数据库：仅支持 mysql")
	flags.StringVar(&dsnFile, "mysql-dsn-file", dsnFile, "MySQL 连接串文件，内容不写入日志")
	importFiles := flags.Bool("migrate-files", false, "保留源文件并全量迁入当前 MySQL，回读验证后切换存储")
	flags.StringVar(&listen, "listen", listen, "监听地址")
	flags.StringVar(&dir, "data-dir", dir, "旧版 MySQL 附件目录")
	webDir := flags.String("web-dir", "apps/web/dist", "Web 构建目录，空值禁用页面")
	if err := flags.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("不支持额外参数")
	}
	if driver != "mysql" {
		return fmt.Errorf("database 仅支持 mysql")
	}
	if dsnFile != "" {
		if dsn != "" {
			return fmt.Errorf("MySQL DSN 与 DSN 文件只能配置一种")
		}
		data, err := os.ReadFile(dsnFile)
		if err != nil {
			return fmt.Errorf("读取 MySQL 连接配置失败：%w", err)
		}
		dsn = string(data)
	}
	if dsn == "" {
		return fmt.Errorf("MySQL 模式需要连接配置")
	}
	if *importFiles {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		result, err := api.MigrateFilesToMySQL(ctx, dir, dsn)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	app, err := api.OpenMySQL(dir, dsn)
	if err != nil {
		return err
	}
	defer app.Close()
	var web fs.FS
	if *webDir != "" {
		root, err := httpserver.WebRoot(*webDir)
		if err != nil {
			return fmt.Errorf("Web 目录: %w", err)
		}
		defer root.Close()
		web = root.FS()
		if _, err = fs.Stat(web, "index.html"); err != nil {
			return fmt.Errorf("缺少 Web 构建产物: %w", err)
		}
	}
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: httpserver.New(web, app), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Minute, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	slog.Info("服务已启动", "address", listener.Addr().String(), "database", driver)
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
			server.Close()
			return err
		}
		return nil
	}
}
