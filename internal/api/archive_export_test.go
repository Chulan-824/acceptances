package api

// Close only storage so HTTP lookup failure tests do not also stop the server
// and release its directory ownership. This seam is absent from production.
func CloseArchiveDatabaseForTest(s *Server) error {
	return s.db.Close()
}
