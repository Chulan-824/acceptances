package dao

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/Chulan-824/acceptances/internal/model"
)

type Campaign struct {
	db *sql.DB
}

func NewCampaign(db *sql.DB) *Campaign { return &Campaign{db: db} }

func (d *Campaign) ProjectExists(ctx context.Context, id string) (bool, error) {
	var found int
	err := d.db.QueryRowContext(ctx, "SELECT 1 FROM projects WHERE id=?", id).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("look up campaign project: %w", err)
	}
	return true, nil
}

func (d *Campaign) Create(ctx context.Context, v model.Campaign) error {
	_, err := d.db.ExecContext(ctx, "INSERT INTO campaigns(id,project_id,title,description,status,latest_run_id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)", v.ID, v.ProjectID, v.Title, v.Description, v.Status, v.LatestRunID, v.CreatedAt, model.CurrentUserID(ctx))
	if err != nil {
		return fmt.Errorf("insert campaign: %w", err)
	}
	return nil
}

func (d *Campaign) List(ctx context.Context, projectID string) ([]model.Campaign, error) {
	rows, err := d.db.QueryContext(ctx, "SELECT c.id,c.project_id,c.title,c.description,c.status,c.latest_run_id,c.created_at,COALESCE(u.id,''),COALESCE(u.username,'') FROM campaigns c LEFT JOIN users u ON u.id=c.created_by WHERE c.project_id=? ORDER BY c.created_at DESC,c.id", projectID)
	if err != nil {
		return nil, fmt.Errorf("list campaigns: %w", err)
	}
	defer rows.Close()
	out := []model.Campaign{}
	for rows.Next() {
		var v model.Campaign
		var user model.User
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.Title, &v.Description, &v.Status, &v.LatestRunID, &v.CreatedAt, &user.ID, &user.Username); err != nil {
			return nil, fmt.Errorf("scan campaign: %w", err)
		}
		if user.ID != "" {
			v.CreatedBy = &user
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate campaigns: %w", err)
	}
	return out, nil
}

func (d *Campaign) Get(ctx context.Context, id string) (model.Campaign, error) {
	var v model.Campaign
	var user model.User
	err := d.db.QueryRowContext(ctx, "SELECT c.id,c.project_id,c.title,c.description,c.status,c.latest_run_id,c.created_at,COALESCE(u.id,''),COALESCE(u.username,'') FROM campaigns c LEFT JOIN users u ON u.id=c.created_by WHERE c.id=?", id).Scan(&v.ID, &v.ProjectID, &v.Title, &v.Description, &v.Status, &v.LatestRunID, &v.CreatedAt, &user.ID, &user.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Campaign{}, model.ErrCampaignNotFound
	}
	if err != nil {
		return model.Campaign{}, fmt.Errorf("read campaign: %w", err)
	}
	if user.ID != "" {
		v.CreatedBy = &user
	}
	return v, nil
}

func (d *Campaign) UpdateDescription(ctx context.Context, id, description string) error {
	_, err := d.db.ExecContext(ctx, "UPDATE campaigns SET description=? WHERE id=?", description, id)
	if err != nil {
		return fmt.Errorf("update campaign description: %w", err)
	}
	return nil
}
