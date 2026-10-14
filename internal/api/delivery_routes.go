package api

import "net/http"

func (s *Server) registerDeliveries(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/campaigns/{id}/delivery", s.campaignDelivery)
	m.HandleFunc("GET /api/v1/runs/{id}/delivery-preparation", s.deliveryPreparation)
	m.HandleFunc("POST /api/v1/runs/{id}/deliveries", s.freezeDelivery)
	m.HandleFunc("GET /api/v1/deliveries", s.listDeliveries)
	m.HandleFunc("GET /api/v1/deliveries/{id}", s.getDelivery)
	m.HandleFunc("GET /api/v1/deliveries/{id}/download", s.downloadDelivery)
	m.HandleFunc("GET /api/v1/deliveries/{id}/evidence/{filename}", s.deliveryEvidence)
	m.HandleFunc("POST /api/v1/deliveries/{id}/revoke", s.revokeDelivery)
	m.HandleFunc("GET /api/v1/deliveries/{id}/documents", s.listDocuments)
	m.HandleFunc("POST /api/v1/deliveries/{id}/documents", s.generateDocument)
	m.HandleFunc("GET /api/v1/documents/{id}", s.getDocument)
	m.HandleFunc("POST /api/v1/documents/{id}/retry", s.retryDocument)
	m.HandleFunc("GET /api/v1/documents/{id}/html", s.documentHTML)
}
