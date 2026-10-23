package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// DecodeJSON preserves the archive API's strict, single-value JSON contract.
func DecodeJSON(w http.ResponseWriter, r *http.Request, value any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("expected one JSON value")
	}
	return nil
}
