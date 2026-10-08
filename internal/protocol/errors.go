package protocol

import "fmt"

type Diagnostic struct {
	Code       string `json:"code"`
	Pointer    string `json:"pointer,omitempty"`
	ResourceID string `json:"resourceId,omitempty"`
	Message    string `json:"message"`
}

type Error struct {
	Code      string       `json:"code"`
	Phase     string       `json:"phase"`
	Message   string       `json:"message"`
	Retryable bool         `json:"retryable"`
	Details   []Diagnostic `json:"details"`
	RequestID string       `json:"requestId,omitempty"`
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }
func Failure(code, pointer, message string) *Error {
	e := &Error{Code: code, Phase: "validation", Message: message, Details: []Diagnostic{{Code: code, Pointer: pointer, Message: message}}}
	switch code {
	case "RATE_LIMITED", "STORAGE_UNAVAILABLE", "INSUFFICIENT_SPACE", "MAINTENANCE", "BASIS_PENDING", "WAIT_TIMEOUT":
		e.Retryable = true
	}
	switch code {
	case "AUTH_REQUIRED", "AUTH_EXPIRED", "FORBIDDEN", "CSRF_REJECTED":
		e.Phase = "authorization"
	case "STORAGE_UNAVAILABLE", "INSUFFICIENT_SPACE":
		e.Phase = "storage"
	case "WAIT_TIMEOUT":
		e.Phase = "waiting"
	case "GATE_UNSATISFIED", "BASIS_PENDING", "REVIEW_BASIS_CONFLICT":
		e.Phase = "review"
	case "DATABASE_UNAVAILABLE", "DATABASE_MIGRATIONS_REQUIRED", "DATABASE_SCHEMA_INCOMPATIBLE", "INITIALIZATION_REQUIRED", "MAINTENANCE", "INTERNAL_ERROR":
		e.Phase = "service"
	}
	return e
}
func (e *Error) HTTPStatus() int {
	switch e.Code {
	case "INVALID_ARGUMENT", "INVALID_JSON":
		return 400
	case "AUTH_REQUIRED", "AUTH_EXPIRED":
		return 401
	case "FORBIDDEN", "CSRF_REJECTED":
		return 403
	case "RESOURCE_NOT_FOUND":
		return 404
	case "UNSUPPORTED_VERSION", "ID_CONTENT_CONFLICT", "IDEMPOTENCY_CONFLICT", "REVISION_FROZEN", "ASSET_INCOMPLETE", "REVIEW_BASIS_CONFLICT":
		return 409
	case "VERSION_PRECONDITION_FAILED":
		return 412
	case "VERSION_PRECONDITION_REQUIRED":
		return 428
	case "LIMIT_EXCEEDED":
		return 413
	case "SCHEMA_INVALID", "REFERENCE_INVALID", "DIGEST_MISMATCH", "PATH_INVALID":
		return 422
	case "RATE_LIMITED":
		return 429
	case "DATABASE_UNAVAILABLE", "DATABASE_MIGRATIONS_REQUIRED", "DATABASE_SCHEMA_INCOMPATIBLE", "INITIALIZATION_REQUIRED", "STORAGE_UNAVAILABLE", "INSUFFICIENT_SPACE", "MAINTENANCE", "BASIS_PENDING":
		return 503
	default:
		return 500
	}
}
func (e *Error) ExitCode() int {
	switch e.Code {
	case "INVALID_JSON", "SCHEMA_INVALID", "REFERENCE_INVALID", "DIGEST_MISMATCH", "PATH_INVALID", "LIMIT_EXCEEDED", "GATE_UNSATISFIED":
		return 1
	case "INVALID_ARGUMENT", "RESOURCE_NOT_FOUND":
		return 2
	case "AUTH_REQUIRED", "AUTH_EXPIRED", "FORBIDDEN", "CSRF_REJECTED":
		return 3
	case "UNSUPPORTED_VERSION", "ID_CONTENT_CONFLICT", "IDEMPOTENCY_CONFLICT", "REVISION_FROZEN", "ASSET_INCOMPLETE", "REVIEW_BASIS_CONFLICT", "VERSION_PRECONDITION_FAILED", "VERSION_PRECONDITION_REQUIRED":
		return 4
	case "RATE_LIMITED", "STORAGE_UNAVAILABLE", "INSUFFICIENT_SPACE", "MAINTENANCE", "BASIS_PENDING", "WAIT_TIMEOUT":
		return 5
	default:
		return 6
	}
}
