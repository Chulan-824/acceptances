package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

func (c client) moveRun(campaigns, projectID, runID, fromCampaign, target, reason, requestID string) (any, error) {
	if runID == "" || fromCampaign == "" || target == "" || strings.TrimSpace(reason) == "" || requestID == "" {
		return nil, fmt.Errorf("--run, --from-campaign, --campaign, --reason and --request-id are required")
	}
	toCampaign, err := c.selectID(campaigns, target, "title")
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(map[string]string{"requestId": requestID, "fromCampaignId": fromCampaign, "toCampaignId": toCampaign, "reason": reason})
	if err != nil {
		return nil, err
	}
	raw, err := c.request("POST", "/runs/"+url.PathEscape(runID)+"/move", bytes.NewReader(payload), "application/json")
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if run, ok := result["run"].(map[string]any); ok {
		if actualCampaign, ok := run["campaignId"].(string); ok {
			result["webUrl"] = c.runURL(projectID, actualCampaign, runID)
		}
	}
	return result, nil
}
