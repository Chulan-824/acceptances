package database

import (
	"context"
	"fmt"
	"io/fs"
	"time"

	"errors"
	"github.com/Chulan-824/acceptances/db"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

const SchemaVersion int64 = 4

type Store struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, fmt.Errorf("database is not configured")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("invalid database configuration")
	}
	config.MaxConns = 8
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("database connection unavailable")
	}
	return &Store{Pool: pool}, nil
}
func (s *Store) Close() { s.Pool.Close() }
func (s *Store) Ready(ctx context.Context) error {
	var version int64
	if err := s.Pool.QueryRow(ctx, "SELECT COALESCE(MAX(version_id),0) FROM goose_db_version WHERE is_applied").Scan(&version); err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "42P01" {
			return protocol.Failure("DATABASE_MIGRATIONS_REQUIRED", "", "database migrations required")
		}
		return protocol.Failure("DATABASE_UNAVAILABLE", "", "database unavailable")
	}
	if version != SchemaVersion {
		return protocol.Failure("DATABASE_SCHEMA_INCOMPATIBLE", "", "database schema incompatible")
	}
	var mode string
	var owner bool
	if err := s.Pool.QueryRow(ctx, "SELECT mode,EXISTS(SELECT 1 FROM owners) FROM installation_control WHERE id=1").Scan(&mode, &owner); err != nil {
		return protocol.Failure("DATABASE_UNAVAILABLE", "", "database control unavailable")
	}
	if mode != "normal" {
		return protocol.Failure("MAINTENANCE", "", "database maintenance in progress")
	}
	if !owner {
		return protocol.Failure("INITIALIZATION_REQUIRED", "", "owner initialization required")
	}
	return nil
}
func (s *Store) Migrate(ctx context.Context) error {
	sqlDB := stdlib.OpenDBFromPool(s.Pool)
	defer sqlDB.Close()
	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return err
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations, goose.WithSessionLocker(locker))
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}
	if _, err = provider.Up(ctx); err != nil {
		return fmt.Errorf("database migration failed")
	}
	return nil
}
