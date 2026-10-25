package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"math/rand/v2"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Chulan-824/acceptances/internal/prd"
)

type larkError struct {
	Code            string
	Retryable, Stop bool
	Delay           time.Duration
}

func (e *larkError) Error() string       { return e.Code }
func larkProblem(code string) *larkError { return &larkError{Code: code} }

type larkConnector struct {
	client       client
	http         *http.Client
	registration prd.Registration
	reader       *larkReader
	output       *json.Encoder
}

func larkCommand(args []string, out, log io.Writer) int {
	fail := func(err error) int { json.NewEncoder(log).Encode(map[string]string{"error": err.Error()}); return 1 }
	if len(args) == 0 || args[0] != "connect" {
		return fail(larkProblem("使用 acceptances lark connect --url <平台地址>"))
	}
	flags := flag.NewFlagSet("lark connect", flag.ContinueOnError)
	flags.SetOutput(log)
	endpoint := flags.String("url", "", "已登录的平台 HTTPS 地址")
	name := flags.String("name", "", "网页显示的电脑名称")
	if err := flags.Parse(args[1:]); err != nil {
		return 1
	}
	if flags.NArg() != 0 {
		return fail(larkProblem("连接器不接受位置参数"))
	}
	base := strings.TrimRight(*endpoint, "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.Scheme != "https" && parsed.Scheme != "http" || parsed.Scheme == "http" && parsed.Hostname() != "localhost" && !net.ParseIP(parsed.Hostname()).IsLoopback() {
		return fail(larkProblem("PLATFORM_URL_INVALID：请指定 HTTPS 平台地址；本机回环地址可使用 HTTP"))
	}
	if *name == "" {
		*name, _ = os.Hostname()
	}
	*name = strings.TrimSpace(*name)
	if *name == "" || len(*name) > 120 {
		return fail(larkProblem("CONNECTOR_NAME_INVALID"))
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	c := &larkConnector{client: client{base: base}, http: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, output: json.NewEncoder(out)}
	if err := c.client.loadSession(); err != nil || c.client.token == "" {
		return fail(larkProblem("PLATFORM_AUTH_REQUIRED：请先运行 acceptances login"))
	}
	if _, _, err := c.request(ctx, "GET", "/auth/me", nil, "", nil); err != nil {
		return fail(err)
	}
	reader, err := newLarkReader(ctx)
	if err != nil {
		return fail(err)
	}
	c.reader = reader
	payload, _ := json.Marshal(map[string]any{"name": *name, "protocolVersion": prd.ProtocolVersion, "larkCliVersion": reader.version})
	raw, _, err := c.request(ctx, "POST", "/lark-connectors", payload, "application/json", nil)
	if err != nil {
		return fail(err)
	}
	if json.Unmarshal(raw, &c.registration) != nil || c.registration.Connector.ID == "" || c.registration.ConnectorToken == "" || c.registration.Connector.ProtocolVersion != prd.ProtocolVersion {
		return fail(larkProblem("CONNECTOR_PROTOCOL_UNSUPPORTED"))
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		c.request(cleanup, "DELETE", "/lark-connectors/"+url.PathEscape(c.registration.Connector.ID), nil, "", nil)
	}()
	if err := c.output.Encode(map[string]any{"event": "ready", "connectorId": c.registration.Connector.ID, "name": *name, "protocolVersion": prd.ProtocolVersion}); err != nil {
		return fail(larkProblem("CONNECTOR_OUTPUT_FAILED"))
	}
	for ctx.Err() == nil {
		claim, err := c.poll(ctx, nil)
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			problem := asLarkError(err)
			if !problem.Retryable {
				return fail(problem)
			}
			c.output.Encode(map[string]string{"event": "reconnecting", "code": problem.Code})
			if !larkWait(ctx, 15*time.Second) {
				break
			}
			continue
		}
		if claim != nil {
			if err := c.execute(ctx, *claim); err != nil {
				if ctx.Err() != nil {
					break
				}
				if problem := asLarkError(err); problem.Stop {
					return fail(problem)
				}
			}
			continue
		}
		if !larkWait(ctx, 15*time.Second) {
			break
		}
	}
	return 0
}

func (c *larkConnector) poll(ctx context.Context, claim *prd.Claim) (*prd.Claim, error) {
	payload := []byte("{}")
	if claim != nil {
		payload, _ = json.Marshal(map[string]any{"importId": claim.ImportID, "attempt": claim.Attempt, "claimToken": claim.ClaimToken})
	}
	raw, status, err := c.request(ctx, "POST", "/lark-connectors/"+url.PathEscape(c.registration.Connector.ID)+"/poll", payload, "application/json", nil)
	if err != nil || status == 204 {
		return nil, err
	}
	var next prd.Claim
	if json.Unmarshal(raw, &next) != nil || next.ImportID == "" || next.Attempt < 1 || next.ClaimToken == "" {
		return nil, larkProblem("CONNECTOR_PROTOCOL_INVALID")
	}
	if expires, err := time.Parse(time.RFC3339Nano, next.LeaseExpiresAt); err != nil || !expires.After(time.Now()) {
		return nil, larkProblem("IMPORT_LEASE_EXPIRED")
	}
	if claim != nil && (next.ImportID != claim.ImportID || next.Attempt != claim.Attempt || next.ClaimToken != claim.ClaimToken) {
		return nil, larkProblem("IMPORT_LEASE_EXPIRED")
	}
	return &next, nil
}

type larkOutcome struct {
	bundle prd.Bundle
	err    error
}

func (c *larkConnector) execute(parent context.Context, claim prd.Claim) error {
	ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
	defer cancel()
	result := make(chan larkOutcome, 1)
	running := true
	go func() { bundle, err := c.reader.fetch(ctx, claim.URL); result <- larkOutcome{bundle, err} }()
	defer func() {
		cancel()
		if running {
			<-result
		}
	}()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	expiry, _ := time.Parse(time.RFC3339Nano, claim.LeaseExpiresAt)
	lease := time.NewTimer(time.Until(expiry))
	defer lease.Stop()
	phase := "reading"
	for {
		select {
		case <-ctx.Done():
			if parent.Err() != nil {
				return nil
			}
			return c.reportFailure(parent, claim, phase, larkProblem("IMPORT_TIMEOUT"))
		case <-lease.C:
			return larkProblem("IMPORT_LEASE_EXPIRED")
		case <-ticker.C:
			renewCtx, renewCancel := context.WithDeadline(ctx, expiry)
			next, err := c.poll(renewCtx, &claim)
			renewCancel()
			if err != nil {
				if phase == "uploading" && asLarkError(err).Code == "IMPORT_LEASE_EXPIRED" {
					ready, recoverErr := c.candidateReady(ctx, claim)
					if recoverErr != nil {
						return recoverErr
					}
					if ready {
						c.importReady(claim)
						return nil
					}
				}
				if problem := asLarkError(err); !problem.Retryable {
					return problem
				}
				continue
			}
			if next == nil {
				return larkProblem("IMPORT_LEASE_EXPIRED")
			}
			expiry, _ = time.Parse(time.RFC3339Nano, next.LeaseExpiresAt)
			lease.Reset(time.Until(expiry))
		case outcome := <-result:
			running = false
			if outcome.err != nil {
				if ctx.Err() != nil {
					if parent.Err() != nil {
						return nil
					}
					return c.reportFailure(parent, claim, phase, larkProblem("IMPORT_TIMEOUT"))
				}
				if phase == "uploading" {
					ready, recoverErr := c.candidateReady(ctx, claim)
					if ready {
						c.importReady(claim)
						return nil
					}
					if recoverErr != nil && asLarkError(recoverErr).Stop {
						return recoverErr
					}
				}
				return c.reportFailure(parent, claim, phase, asLarkError(outcome.err))
			}
			if phase == "uploading" {
				c.importReady(claim)
				return nil
			}
			// Revalidate the lease immediately before releasing document bytes.
			renewCtx, renewCancel := context.WithDeadline(ctx, expiry)
			next, err := c.poll(renewCtx, &claim)
			renewCancel()
			if err != nil {
				return err
			}
			if next == nil {
				return larkProblem("IMPORT_LEASE_EXPIRED")
			}
			expiry, _ = time.Parse(time.RFC3339Nano, next.LeaseExpiresAt)
			lease.Reset(time.Until(expiry))
			phase, running = "uploading", true
			go func() { result <- larkOutcome{err: c.upload(ctx, claim, outcome.bundle)} }()
		}
	}
}

func (c *larkConnector) importReady(claim prd.Claim) {
	c.output.Encode(map[string]string{"event": "import_ready", "importId": claim.ImportID})
}

func (c *larkConnector) candidateReady(ctx context.Context, claim prd.Claim) (bool, error) {
	raw, _, err := c.request(ctx, "GET", "/prd-imports/"+url.PathEscape(claim.ImportID), nil, "", nil)
	if err != nil {
		return false, err
	}
	var imported prd.Import
	if json.Unmarshal(raw, &imported) != nil || imported.ID != claim.ImportID || imported.Attempt != claim.Attempt || imported.ConnectorID != c.registration.Connector.ID {
		return false, larkProblem("CONNECTOR_PROTOCOL_INVALID")
	}
	return imported.Status == "ready" || imported.Status == "confirmed", nil
}

func (c *larkConnector) reportFailure(ctx context.Context, claim prd.Claim, phase string, problem *larkError) error {
	payload, _ := json.Marshal(map[string]any{"errorCode": problem.Code, "phase": phase, "retryable": problem.Retryable})
	_, _, err := c.request(ctx, "POST", "/prd-imports/"+url.PathEscape(claim.ImportID)+"/failure", payload, "application/json", &claim)
	if err != nil {
		if problem.Stop {
			return problem
		}
		return err
	}
	c.output.Encode(map[string]string{"event": "import_failed", "importId": claim.ImportID, "code": problem.Code})
	return problem
}

func (c *larkConnector) upload(ctx context.Context, claim prd.Claim, bundle prd.Bundle) error {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	raw, err := json.Marshal(bundle.Manifest)
	if err != nil {
		return larkProblem("LARK_INVALID_RESULT")
	}
	if err := writer.WriteField("manifest", string(raw)); err != nil {
		return larkProblem("LARK_INVALID_RESULT")
	}
	for _, file := range bundle.Manifest.Files {
		part, err := writer.CreateFormFile("file", file.Name)
		if err != nil {
			return larkProblem("LARK_INVALID_RESULT")
		}
		if _, err := part.Write(bundle.Files[file.Name]); err != nil {
			return larkProblem("LARK_INVALID_RESULT")
		}
	}
	if writer.Close() != nil {
		return larkProblem("LARK_INVALID_RESULT")
	}
	if body.Len() > prd.MaxUploadBytes {
		return larkProblem("LARK_LIMIT_EXCEEDED")
	}
	_, status, err := c.request(ctx, "POST", "/prd-imports/"+url.PathEscape(claim.ImportID)+"/result", body.Bytes(), writer.FormDataContentType(), &claim)
	if status == 400 {
		return larkProblem("LARK_INVALID_RESULT")
	}
	if status == 413 {
		return larkProblem("LARK_LIMIT_EXCEEDED")
	}
	return err
}

func (c *larkConnector) request(ctx context.Context, method, path string, body []byte, contentType string, claim *prd.Claim) ([]byte, int, error) {
	var last *larkError
	for attempt := range 3 {
		if attempt > 0 && !larkWait(ctx, larkBackoff(attempt, last.Delay)) {
			return nil, 0, larkProblem("CONNECTOR_CANCELLED")
		}
		request, err := http.NewRequestWithContext(ctx, method, c.client.base+"/api/v1"+path, bytes.NewReader(body))
		if err != nil {
			return nil, 0, larkProblem("PLATFORM_URL_INVALID")
		}
		request.Header.Set("Authorization", "Bearer "+c.client.token)
		if contentType != "" {
			request.Header.Set("Content-Type", contentType)
		}
		if c.registration.ConnectorToken != "" {
			request.Header.Set("X-Acceptances-Connector-Token", c.registration.ConnectorToken)
		}
		if claim != nil {
			request.Header.Set("X-Acceptances-Claim-Token", claim.ClaimToken)
			request.Header.Set("X-Acceptances-Claim-Attempt", strconv.Itoa(claim.Attempt))
		}
		httpClient := c.http
		if method == "POST" && strings.HasSuffix(path, "/result") {
			// Large bundles use the task context and concurrent lease heartbeat;
			// the control-request timeout would reject ordinary slow uploads.
			uploadClient := *c.http
			uploadClient.Timeout = 0
			httpClient = &uploadClient
		}
		response, err := httpClient.Do(request)
		if err != nil {
			if ctx.Err() != nil {
				return nil, 0, larkProblem("CONNECTOR_CANCELLED")
			}
			last = &larkError{Code: "PLATFORM_UNAVAILABLE", Retryable: true}
			continue
		}
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 2*prd.MaxManifestBytes+1))
		response.Body.Close()
		if readErr != nil {
			last = &larkError{Code: "PLATFORM_UNAVAILABLE", Retryable: true}
			continue
		}
		if len(raw) > 2*prd.MaxManifestBytes {
			return nil, response.StatusCode, larkProblem("CONNECTOR_PROTOCOL_INVALID")
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			return raw, response.StatusCode, nil
		}
		switch response.StatusCode {
		case 401, 403:
			return nil, response.StatusCode, &larkError{Code: "PLATFORM_AUTH_REQUIRED", Stop: true}
		case 409, 410:
			return nil, response.StatusCode, larkProblem("IMPORT_LEASE_EXPIRED")
		case 429, 502, 503, 504:
			last = &larkError{Code: "PLATFORM_UNAVAILABLE", Retryable: true, Delay: retryAfter(response.Header.Get("Retry-After"))}
		default:
			return nil, response.StatusCode, larkProblem("PLATFORM_REQUEST_REJECTED")
		}
	}
	return nil, 0, last
}

func asLarkError(err error) *larkError {
	if problem, ok := errors.AsType[*larkError](err); ok {
		return problem
	}
	return larkProblem("LARK_FETCH_FAILED")
}
func larkWait(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
func larkBackoff(attempt int, delay time.Duration) time.Duration {
	if delay <= 0 {
		delay = time.Second * time.Duration(1<<attempt)
	}
	if delay > 60*time.Second {
		delay = 60 * time.Second
	}
	return delay + time.Duration(rand.IntN(250))*time.Millisecond
}
func retryAfter(value string) time.Duration {
	if n, err := strconv.Atoi(value); err == nil && n > 0 {
		return time.Duration(min(n, 60)) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil {
		return max(0, min(time.Until(at), 60*time.Second))
	}
	return 0
}
