package api

import (
	"database/sql"
	"net/http"
)

// Campaign delivery follows the authoritative latest Run, never the report
// selected in the UI. Readiness uses the same validation as final confirmation.
type DeliveryReadiness struct {
	RunID        string          `json:"runId"`
	Status       string          `json:"status"`
	ScopeType    string          `json:"scopeType"`
	ReviewCounts ReviewCounts    `json:"reviewCounts"`
	Eligible     bool            `json:"eligible"`
	Issues       []DeliveryIssue `json:"issues"`
}

type CampaignDeliveryOverview struct {
	CampaignID      string             `json:"campaignId"`
	Preparation     *DeliveryReadiness `json:"preparation"`
	CurrentDelivery *DeliverySummary   `json:"currentDelivery"`
	LatestDelivery  *DeliverySummary   `json:"latestDelivery"`
	LatestDocument  *BusinessDocument  `json:"latestDocument"`
	LatestGuide     *BusinessDocument  `json:"latestGuide"`
}

func (s *Server) campaignDelivery(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	campaign, err := s.campaign(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "CAMPAIGN_NOT_FOUND")
		return
	}
	view := CampaignDeliveryOverview{CampaignID: campaign.ID}
	if campaign.LatestRunID != "" {
		prep, err := s.prepareDelivery(campaign.LatestRunID)
		if err != nil {
			lookupFailure(w, r, err, "RUN_NOT_FOUND")
			return
		}
		view.Preparation = &DeliveryReadiness{
			RunID: prep.Run.ID, Status: prep.Run.humanStatus(), ScopeType: prep.Run.Report.ScopeType,
			ReviewCounts: prep.Run.ReviewCounts, Eligible: prep.Eligible, Issues: prep.Issues,
		}
	}
	items, err := s.deliverySummaries(r.Context(), "campaign_id=?", campaign.ID)
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	if len(items) > 0 {
		view.LatestDelivery = &items[0]
	}
	for i := range items {
		if items[i].Status == "valid" {
			view.CurrentDelivery = &items[i]
			break
		}
	}
	source := view.CurrentDelivery
	if source == nil {
		source = view.LatestDelivery
	}
	if source != nil {
		for _, kind := range []DocumentKind{TestReportDocument, BusinessGuideDocument} {
			var key string
			err = s.db.QueryRowContext(r.Context(), "SELECT id FROM business_documents WHERE delivery_id=? AND kind=? ORDER BY version DESC LIMIT 1", source.ID, kind).Scan(&key)
			if err == nil {
				document, readErr := s.document(key)
				if readErr != nil {
					fail(w, 500, "READ_FAILED")
					return
				}
				if kind == BusinessGuideDocument {
					view.LatestGuide = &document
				} else {
					view.LatestDocument = &document
				}
			} else if err != sql.ErrNoRows {
				fail(w, 500, "READ_FAILED")
				return
			}
		}
	}

	respond(w, 200, view)
}
