package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/google/uuid"
)

var (
	ErrProjectNotFound     = errors.New("project not found")
	ErrTitleRequired       = errors.New("title required")
	ErrDescriptionRequired = errors.New("description required")
	ErrReadFailed          = errors.New("read failed")
	ErrSaveFailed          = errors.New("save failed")
)

// CampaignStore describes only the persistence needed by these four use cases.
type CampaignStore interface {
	ProjectExists(context.Context, string) (bool, error)
	Create(context.Context, model.Campaign) error
	List(context.Context, string) ([]model.Campaign, error)
	Get(context.Context, string) (model.Campaign, error)
	UpdateDescription(context.Context, string, string) error
}

type Campaign struct {
	store     CampaignStore
	mutations sync.Locker
}

// mutations must be the archive's shared mutation lock while legacy modules
// still update campaigns, so updating and reading the result remain serialized.
func NewCampaign(store CampaignStore, mutations sync.Locker) *Campaign {
	return &Campaign{store: store, mutations: mutations}
}

func (s *Campaign) RequireProject(ctx context.Context, id string) error {
	exists, err := s.store.ProjectExists(ctx, id)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrReadFailed, err)
	}
	if !exists {
		return ErrProjectNotFound
	}
	return nil
}

func (s *Campaign) Create(ctx context.Context, projectID, title, description string) (model.Campaign, error) {
	if err := s.RequireProject(ctx, projectID); err != nil {
		return model.Campaign{}, err
	}
	if strings.TrimSpace(title) == "" {
		return model.Campaign{}, ErrTitleRequired
	}
	v := model.Campaign{
		ID: uuid.NewString(), ProjectID: projectID, Title: title,
		Description: description, Status: "pending",
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := s.store.Create(ctx, v); err != nil {
		return model.Campaign{}, fmt.Errorf("%w: %w", ErrSaveFailed, err)
	}
	return v, nil
}

func (s *Campaign) List(ctx context.Context, projectID string) ([]model.Campaign, error) {
	if err := s.RequireProject(ctx, projectID); err != nil {
		return nil, err
	}
	items, err := s.store.List(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrReadFailed, err)
	}
	return items, nil
}

func (s *Campaign) Get(ctx context.Context, id string) (model.Campaign, error) {
	v, err := s.store.Get(ctx, id)
	if errors.Is(err, model.ErrCampaignNotFound) {
		return model.Campaign{}, model.ErrCampaignNotFound
	}
	if err != nil {
		return model.Campaign{}, fmt.Errorf("%w: %w", ErrReadFailed, err)
	}
	return v, nil
}

func (s *Campaign) UpdateDescription(ctx context.Context, id string, description *string) (model.Campaign, error) {
	if description == nil || len(*description) > 65536 {
		return model.Campaign{}, ErrDescriptionRequired
	}
	s.mutations.Lock()
	defer s.mutations.Unlock()
	if err := s.store.UpdateDescription(ctx, id, *description); err != nil {
		return model.Campaign{}, fmt.Errorf("%w: %w", ErrSaveFailed, err)
	}
	// Read to determine existence: MySQL reports zero changed rows for an unchanged value.
	return s.Get(ctx, id)
}
