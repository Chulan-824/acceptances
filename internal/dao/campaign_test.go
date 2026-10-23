package dao_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/dao"
	"github.com/Chulan-824/acceptances/internal/model"
)

func campaignDatabase(t *testing.T) (*sql.DB, *dao.Campaign) {
	t.Helper()
	dir := t.TempDir()
	app, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(filepath.Join(dir, "archive.db"))+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	for _, id := range []string{"project", "other"} {
		if _, err := db.ExecContext(t.Context(), "INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)", id, id, "", "2026-01-01T00:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}
	return db, dao.NewCampaign(db)
}

func TestCampaignPersistence(t *testing.T) {
	t.Parallel()
	_, store := campaignDatabase(t)
	ctx := t.Context()
	for _, tc := range []struct {
		name, id string
		want     bool
	}{{"existing", "project", true}, {"missing", "missing", false}, {"literal SQL", "' OR 1=1 --", false}} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := store.ProjectExists(ctx, tc.id)
			if err != nil || got != tc.want {
				t.Fatalf("ProjectExists = %v, %v", got, err)
			}
		})
	}
	if got, err := store.List(ctx, "project"); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("empty list = %v, %v", got, err)
	}
	values := []model.Campaign{
		{ID: "older", ProjectID: "project", Title: "Old", Status: "pending", CreatedAt: "2026-01-01T00:00:00Z"},
		{ID: "b", ProjectID: "project", Title: "B", Status: "pending", CreatedAt: "2026-01-02T00:00:00Z"},
		{ID: "a", ProjectID: "project", Title: "A", Status: "accepted", LatestRunID: "existing-run", CreatedAt: "2026-01-02T00:00:00Z"},
		{ID: "other", ProjectID: "other", Title: "Other", Status: "pending", CreatedAt: "2026-01-03T00:00:00Z"},
	}
	for _, v := range values {
		if err := store.Create(ctx, v); err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.List(ctx, "project")
	if err != nil || !reflect.DeepEqual(got, []model.Campaign{values[2], values[1], values[0]}) {
		t.Fatalf("project ordering = %v, %v", got, err)
	}
	if err := store.Create(ctx, values[0]); err == nil {
		t.Fatal("duplicate ID accepted")
	}
	if err := store.Create(ctx, model.Campaign{ID: "orphan", ProjectID: "missing"}); err == nil {
		t.Fatal("missing parent accepted")
	}
	if err := store.UpdateDescription(ctx, "a", "新描述"); err != nil {
		t.Fatalf("update = %v", err)
	}
	want := values[2]
	want.Description = "新描述"
	if got, err := store.Get(ctx, "a"); err != nil || got != want {
		t.Fatalf("persisted update = %+v, %v", got, err)
	}
	if got, err := store.Get(ctx, "b"); err != nil || got != values[1] {
		t.Fatalf("unrelated campaign changed: %+v, %v", got, err)
	}
	if err := store.UpdateDescription(ctx, "missing", "x"); err != nil {
		t.Fatalf("missing update = %v", err)
	}
	if _, err := store.Get(ctx, "missing"); !errors.Is(err, model.ErrCampaignNotFound) {
		t.Fatalf("missing get = %v", err)
	}
}

func TestCampaignStorageFailures(t *testing.T) {
	t.Parallel()
	for _, failure := range []string{"cancelled", "closed database"} {
		t.Run(failure, func(t *testing.T) {
			t.Parallel()
			db, store := campaignDatabase(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if failure == "cancelled" {
				cancel()
			} else if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			for _, tc := range []struct {
				name string
				run  func() error
			}{
				{"project", func() error { _, err := store.ProjectExists(ctx, "project"); return err }},
				{"create", func() error { return store.Create(ctx, model.Campaign{ID: "a", ProjectID: "project"}) }},
				{"list", func() error { _, err := store.List(ctx, "project"); return err }},
				{"get", func() error { _, err := store.Get(ctx, "a"); return err }},
				{"update", func() error { return store.UpdateDescription(ctx, "a", "x") }},
			} {
				t.Run(tc.name, func(t *testing.T) {
					err := tc.run()
					if err == nil || errors.Is(err, model.ErrCampaignNotFound) {
						t.Fatalf("storage failure mistaken for success or absence: %v", err)
					}
					if failure == "cancelled" && !errors.Is(err, context.Canceled) {
						t.Fatalf("cancellation cause lost: %v", err)
					}
				})
			}
		})
	}
}
