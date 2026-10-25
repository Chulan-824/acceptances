package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/google/uuid"
)

type PRDError struct{ Code string }

func (e *PRDError) Error() string { return e.Code }
func prdError(code string) error  { return &PRDError{Code: code} }

var ErrPRDRecordNotFound = errors.New("PRD record not found")

const (
	connectorOnlineFor = 30 * time.Second
	claimLeaseFor      = 90 * time.Second
	queuedImportTTL    = 2 * time.Minute
	fetchingImportTTL  = 10 * time.Minute
	candidateImportTTL = 24 * time.Hour
)

type PRDConnector struct {
	Value        prd.Connector
	UserID       string
	TokenHash    string
	Disconnected bool
}

type PRDStore interface {
	Transact(context.Context, func(PRDStore) error) error
	InsertConnector(context.Context, PRDConnector) error
	GetConnector(context.Context, string) (PRDConnector, error)
	ListConnectors(context.Context, string) ([]PRDConnector, error)
	UpdateConnector(context.Context, PRDConnector) error
	CampaignExists(context.Context, string) (bool, error)
	GetImport(context.Context, string) (PRDImport, error)
	FindImport(context.Context, string, string, string) (PRDImport, error)
	InsertImport(context.Context, PRDImport) error
	UpdateImport(context.Context, PRDImport) error
	PendingImports(context.Context, string) ([]PRDImport, error)
	CurrentSnapshot(context.Context, string) (string, error)
	ListSnapshots(context.Context, string) ([]prd.Snapshot, error)
	GetSnapshot(context.Context, string) (prd.Snapshot, error)
	InsertSnapshot(context.Context, prd.Snapshot, string) error
	SetCurrentSnapshot(context.Context, string, string) error
	InsertFiles(context.Context, string, []PRDStoredFile) error
	CheckFiles(context.Context, string, []prd.File) error
	ClearCandidateFiles(context.Context, string) error
}

type PRDImport struct {
	Value                                           prd.Import
	UserID, ClientRequestID, RequestHash, ClaimHash string
	LeaseExpires                                    time.Time
	SourceHash, ResourceHash, ResultHash            string
}

type PRDStoredFile struct {
	Name       string
	BlobID     uint64
	ModifiedAt time.Time
}

type PRD struct {
	store     PRDStore
	mutations sync.Locker
	stage     PRDFileStage
}

type PRDFileStage func(context.Context, map[string][]byte) ([]PRDStoredFile, func(), error)

func NewPRD(store PRDStore, mutations sync.Locker, stage PRDFileStage) *PRD {
	return &PRD{store: store, mutations: mutations, stage: stage}
}

func (s *PRD) mutate(ctx context.Context, fn func(PRDStore) error) error {
	s.mutations.Lock()
	defer s.mutations.Unlock()
	return s.store.Transact(ctx, fn)
}

func prdToken() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func prdHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (s *PRD) RegisterConnector(ctx context.Context, name string, version int, cliVersion string) (prd.Registration, error) {
	if strings.TrimSpace(name) == "" || len(name) > 200 || version != prd.ProtocolVersion || len(cliVersion) > 100 || cliVersion == "" {
		return prd.Registration{}, prdError("CONNECTOR_PROTOCOL_UNSUPPORTED")
	}
	token, err := prdToken()
	if err != nil {
		return prd.Registration{}, err
	}
	v := prd.Connector{ID: uuid.NewString(), Name: strings.TrimSpace(name), ProtocolVersion: version, LarkCliVersion: cliVersion, LastSeenAt: time.Now().UTC().Format(time.RFC3339Nano), Online: true}
	record := PRDConnector{Value: v, UserID: model.CurrentUser(ctx).ID, TokenHash: prdHash(token)}
	if err = s.mutate(ctx, func(store PRDStore) error { return store.InsertConnector(ctx, record) }); err != nil {
		return prd.Registration{}, err
	}
	return prd.Registration{Connector: v, ConnectorToken: token}, nil
}

func (s *PRD) Connectors(ctx context.Context) ([]prd.Connector, error) {
	records, err := s.store.ListConnectors(ctx, model.CurrentUser(ctx).ID)
	if err != nil {
		return nil, err
	}
	result := []prd.Connector{}
	for _, record := range records {
		if record.Disconnected {
			continue
		}
		seen, _ := time.Parse(time.RFC3339Nano, record.Value.LastSeenAt)
		record.Value.Online = time.Since(seen) <= connectorOnlineFor
		result = append(result, record.Value)
	}
	return result, nil
}

func (s *PRD) Disconnect(ctx context.Context, id string) error {
	return s.mutate(ctx, func(store PRDStore) error {
		record, err := ownedConnector(ctx, store, id)
		if err != nil {
			return err
		}
		record.Disconnected = true
		if err = store.UpdateConnector(ctx, record); err != nil {
			return err
		}
		pending, err := store.PendingImports(ctx, id)
		if err != nil {
			return err
		}
		for _, task := range pending {
			if task.Value.Status == "ready" {
				continue
			}
			task.Value.Status, task.Value.ErrorCode = "failed", "CONNECTOR_DISCONNECTED"
			task.Value.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			if err = store.UpdateImport(ctx, task); err != nil {
				return err
			}
		}
		return nil
	})
}
