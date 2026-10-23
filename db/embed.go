package db

import "embed"

// MySQL contains the versioned MySQL schema shipped with the server.
//
//go:embed migrations/mysql/*.sql
var MySQL embed.FS
