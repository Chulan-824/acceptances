package api

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
)

// deliveryTransaction checks archive ownership before and after each write.
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
		// Discard a connection with an uncertain COMMIT before checking ownership.
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
	}
	return err
}
