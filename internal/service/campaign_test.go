package service_test

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/Chulan-824/acceptances/internal/service"
	"github.com/google/uuid"
)

type campaignStore struct {
	project func(context.Context, string) (bool, error)
	create  func(context.Context, model.Campaign) error
	list    func(context.Context, string) ([]model.Campaign, error)
	get     func(context.Context, string) (model.Campaign, error)
	update  func(context.Context, string, string) error
}

func (s campaignStore) ProjectExists(ctx context.Context, id string) (bool, error) {
	return s.project(ctx, id)
}
func (s campaignStore) Create(ctx context.Context, v model.Campaign) error { return s.create(ctx, v) }
func (s campaignStore) List(ctx context.Context, id string) ([]model.Campaign, error) {
	return s.list(ctx, id)
}
func (s campaignStore) Get(ctx context.Context, id string) (model.Campaign, error) {
	return s.get(ctx, id)
}
func (s campaignStore) UpdateDescription(ctx context.Context, id, description string) error {
	return s.update(ctx, id, description)
}

func TestCampaignCreate(t *testing.T) {
	t.Parallel()
	fault := errors.New("storage unavailable")
	for _, tc := range []struct {
		name, title string
		exists      bool
		lookupErr   error
		saveErr     error
		want        error
	}{
		{name: "preserve input", title: " 标题 ", exists: true},
		{name: "blank title", title: " \t ", exists: true, want: service.ErrTitleRequired},
		{name: "missing project", title: "valid", want: service.ErrProjectNotFound},
		{name: "project precedes title", want: service.ErrProjectNotFound},
		{name: "lookup failure", title: "valid", lookupErr: fault, want: service.ErrReadFailed},
		{name: "save failure", title: "valid", exists: true, saveErr: fault, want: service.ErrSaveFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var saved *model.Campaign
			store := campaignStore{
				project: func(ctx context.Context, id string) (bool, error) {
					if ctx != t.Context() || id != "project" {
						t.Fatal("project lookup lost context or ownership")
					}
					return tc.exists, tc.lookupErr
				},
				create: func(ctx context.Context, v model.Campaign) error {
					if ctx != t.Context() {
						t.Fatal("insert lost request context")
					}
					saved = &v
					return tc.saveErr
				},
			}
			got, err := service.NewCampaign(store, &sync.Mutex{}).Create(t.Context(), "project", tc.title, "原始描述")
			if !errors.Is(err, tc.want) {
				t.Fatalf("Create error = %v, want %v", err, tc.want)
			}
			if tc.lookupErr != nil || tc.saveErr != nil {
				if !errors.Is(err, fault) {
					t.Fatal("storage cause lost")
				}
			}
			if tc.want != nil {
				if tc.saveErr == nil && saved != nil {
					t.Fatal("invalid request was saved")
				}
				return
			}
			if saved == nil || got != *saved || got.Title != tc.title || got.Description != "原始描述" || got.ProjectID != "project" || got.Status != "pending" || got.LatestRunID != "" {
				t.Fatalf("unexpected campaign: %+v", got)
			}
			if _, err := uuid.Parse(got.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := time.Parse(time.RFC3339Nano, got.CreatedAt); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCampaignReadErrors(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		err  error
		want error
	}{
		{"missing", model.ErrCampaignNotFound, model.ErrCampaignNotFound},
		{"cancelled", context.Canceled, service.ErrReadFailed},
		{"failed", errors.New("disk failed"), service.ErrReadFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := campaignStore{get: func(ctx context.Context, id string) (model.Campaign, error) {
				if ctx != t.Context() || id != "campaign" {
					t.Fatal("get lost context or identity")
				}
				return model.Campaign{}, tc.err
			}}
			_, err := service.NewCampaign(store, &sync.Mutex{}).Get(t.Context(), "campaign")
			if !errors.Is(err, tc.want) || !errors.Is(err, tc.err) {
				t.Fatalf("Get error = %v", err)
			}
		})
	}
	t.Run("list failure", func(t *testing.T) {
		store := campaignStore{
			project: func(context.Context, string) (bool, error) { return true, nil },
			list:    func(context.Context, string) ([]model.Campaign, error) { return nil, context.Canceled },
		}
		_, err := service.NewCampaign(store, &sync.Mutex{}).List(t.Context(), "project")
		if !errors.Is(err, service.ErrReadFailed) || !errors.Is(err, context.Canceled) {
			t.Fatalf("List error = %v", err)
		}
	})
}

func TestCampaignUpdateDescription(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name        string
		description *string
		saveErr     error
		getErr      error
		want        error
	}{
		{name: "missing", want: service.ErrDescriptionRequired},
		{name: "too many bytes", description: new(strings.Repeat("界", 21846)), want: service.ErrDescriptionRequired},
		{name: "unchanged is valid", description: new("before")},
		{name: "empty is valid", description: new("")},
		{name: "limit is valid", description: new(strings.Repeat("a", 65536))},
		{name: "missing campaign", description: new("x"), getErr: model.ErrCampaignNotFound, want: model.ErrCampaignNotFound},
		{name: "write failed", description: new("x"), saveErr: context.Canceled, want: service.ErrSaveFailed},
		{name: "read failed", description: new("x"), getErr: context.Canceled, want: service.ErrReadFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			before := model.Campaign{ID: "campaign", ProjectID: "project", Title: "title", Description: "before", Status: "accepted", LatestRunID: "run", CreatedAt: "original"}
			persisted := before
			store := campaignStore{
				update: func(ctx context.Context, id, description string) error {
					if tc.want == service.ErrDescriptionRequired {
						t.Fatal("invalid description reached persistence")
					}
					if ctx != t.Context() || id != before.ID {
						t.Fatal("update lost context or identity")
					}
					if tc.saveErr != nil {
						return tc.saveErr
					}
					persisted.Description = description
					return nil
				},
				get: func(ctx context.Context, id string) (model.Campaign, error) {
					if ctx != t.Context() || id != before.ID {
						t.Fatal("read after update lost context or identity")
					}
					if tc.saveErr != nil || tc.want == service.ErrDescriptionRequired {
						t.Fatal("failed update continued to read")
					}
					return persisted, tc.getErr
				},
			}
			got, err := service.NewCampaign(store, &sync.Mutex{}).UpdateDescription(t.Context(), before.ID, tc.description)
			if !errors.Is(err, tc.want) {
				t.Fatalf("UpdateDescription error = %v, want %v", err, tc.want)
			}
			for _, cause := range []error{tc.saveErr, tc.getErr} {
				if cause != nil && !errors.Is(err, cause) {
					t.Fatalf("storage cause lost: %v", cause)
				}
			}
			if err == nil {
				before.Description = *tc.description
				if got != before {
					t.Fatal("update changed immutable campaign fields")
				}
			}
		})
	}
}

func TestCampaignConcurrentUpdatesReturnTheirOwnDescription(t *testing.T) {
	t.Parallel()
	var stored model.Campaign
	store := campaignStore{
		update: func(_ context.Context, id, description string) error {
			stored = model.Campaign{ID: id, Description: description}
			runtime.Gosched()
			return nil
		},
		get: func(context.Context, string) (model.Campaign, error) { return stored, nil },
	}
	var lock sync.Mutex
	// Two adapters may exist during migration; both must use the archive's lock.
	services := []*service.Campaign{service.NewCampaign(store, &lock), service.NewCampaign(store, &lock)}
	failures := make(chan error, 64)
	var wg sync.WaitGroup
	for i := range 64 {
		wg.Go(func() {
			want := fmt.Sprintf("description-%d", i)
			got, err := services[i%2].UpdateDescription(t.Context(), "campaign", &want)
			if err != nil || got.Description != want {
				failures <- fmt.Errorf("update %d: got %q, error %v", i, got.Description, err)
			}
		})
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
}
