package api

import (
	"encoding/json"
	"net/http"
)

// Dashboard exposes only the latest report summary; historical evidence and reviews
// remain on the Run endpoint. A single query keeps campaign and run state coherent.
type DashboardItem struct {
	Campaign
	ProjectName string        `json:"projectName"`
	LatestRun   *DashboardRun `json:"latestRun"`
}
type DashboardRun struct {
	ID            string           `json:"id"`
	Status        string           `json:"status"`
	CreatedAt     string           `json:"createdAt"`
	VerifiedAt    string           `json:"verifiedAt"`
	ScopeType     string           `json:"scopeType"`
	Versions      []Version        `json:"versions"`
	Counts        map[string]int   `json:"counts"`
	EvidenceCount int              `json:"evidenceCount"`
	Checks        []DashboardCheck `json:"checks"`
}
type DashboardCheck struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT c.id,c.project_id,c.title,c.description,c.status,c.latest_run_id,c.created_at,p.name,
 COALESCE(r.id,''),COALESCE(r.status,''),COALESCE(r.created_at,''),COALESCE(r.report,'')
 FROM campaigns c JOIN projects p ON p.id=c.project_id
 LEFT JOIN runs r ON r.id=c.latest_run_id AND r.campaign_id=c.id
 ORDER BY COALESCE(r.created_at,c.created_at) DESC,c.id`)
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	defer rows.Close()
	items := []DashboardItem{}
	for rows.Next() {
		var item DashboardItem
		var run DashboardRun
		var raw string
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Title, &item.Description, &item.Status, &item.LatestRunID, &item.CreatedAt, &item.ProjectName, &run.ID, &run.Status, &run.CreatedAt, &raw); err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if run.ID != "" {
			var report Report
			if err := json.Unmarshal([]byte(raw), &report); err != nil {
				fail(w, 500, "READ_FAILED")
				return
			}
			run.VerifiedAt, run.ScopeType, run.Versions = report.VerifiedAt, report.ScopeType, report.Versions
			if run.ScopeType == "" {
				run.ScopeType = "unknown"
			}
			if run.Versions == nil {
				run.Versions = []Version{}
			}
			run.EvidenceCount = len(report.Evidence)
			run.Counts = map[string]int{"passed": 0, "failed": 0, "blocked": 0, "skipped": 0}
			run.Checks = []DashboardCheck{}
			for _, check := range report.Checks {
				run.Counts[check.Status]++
				if len(run.Checks) < 4 {
					run.Checks = append(run.Checks, DashboardCheck{check.ID, check.Title, check.Status})
				}
			}
			item.LatestRun = &run
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	respond(w, 200, map[string]any{"items": items})
}
