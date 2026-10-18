package api

// Test-only access to the per-archive fault seam; absent from production builds.
func SetDeliveryArtifactCheckpointForTest(s *Server, checkpoint func(phase, path string) error) {
	s.artifacts.checkpoint = checkpoint
}
