package api

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
)

// deliveryTransaction ends the SQLite transaction before file ownership can be
// checked. Both snapshot publication and document reservation depend on this.
func (s *Server) deliveryTransaction(ctx context.Context, write func(*sql.Tx) error) (err error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			err = errors.Join(err, rollbackErr)
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		}
	}()
	if err = s.checkTransactionLease(ctx, tx); err != nil {
		return err
	}
	if err = write(tx); err != nil {
		return err
	}
	if err = s.checkTransactionLease(ctx, tx); err != nil {
		return err
	}
	err = tx.Commit()
	if err != nil {
		// SQLite can leave a transaction open after COMMIT fails, while
		// database/sql considers this Tx done and refuses Rollback. Discard
		// that exact connection before checking durable file ownership.
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
	}
	return err
}
