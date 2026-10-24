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
		driver = "sqlite"
		if dsnFile != "" || dsn != "" {
			driver = "mysql"
		}
	}
	flags.StringVar(&driver, "database", driver, "数据库：mysql 或 sqlite")
	flags.StringVar(&dsnFile, "mysql-dsn-file", dsnFile, "MySQL 连接串文件，内容不写入日志")
	importSQLite := flags.Bool("migrate-sqlite", false, "备份并迁移数据目录中的 SQLite 到空 MySQL，完成后退出")
	importFiles := flags.Bool("migrate-files", false, "保留源文件并全量迁入当前 MySQL，回读验证后切换存储")
	flags.StringVar(&listen, "listen", listen, "监听地址")
	flags.StringVar(&dir, "data-dir", dir, "归档附件目录，SQLite 模式下也保存数据库")
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
	if driver != "sqlite" && driver != "mysql" {
		return fmt.Errorf("database 必须是 mysql 或 sqlite")
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
	if driver == "mysql" && dsn == "" {
		return fmt.Errorf("MySQL 模式需要连接配置")
	}
	if driver == "sqlite" && dsn != "" {
		return fmt.Errorf("SQLite 模式不能同时配置 MySQL")
	}
	if *importSQLite {
		if *importFiles {
			return fmt.Errorf("SQLite 业务迁移和文件迁移须分开执行")
		}
		if driver != "mysql" {
			return fmt.Errorf("迁移需要 --database=mysql")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		result, err := api.MigrateSQLiteToMySQL(ctx, dir, dsn)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	if *importFiles {
		if driver != "mysql" {
			return fmt.Errorf("文件迁移需要 --database=mysql")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		result, err := api.MigrateFilesToMySQL(ctx, dir, dsn)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	var app *api.Server
	var err error
	if driver == "mysql" {
		app, err = api.OpenMySQL(dir, dsn)
	} else {
		app, err = api.Open(dir)
	}
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
