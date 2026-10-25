package model

import "errors"

var ErrCampaignNotFound = errors.New("campaign not found")

type Campaign struct {
	CreatedBy   *User  `json:"createdBy,omitempty"`
	ID          string `json:"id"`
	ProjectID   string `json:"projectId"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	LatestRunID string `json:"latestRunId"`
	CreatedAt   string `json:"createdAt"`
}
