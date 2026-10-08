// Package contracts embeds the versioned, authoritative document schemas.
package contracts

import "embed"

//go:embed schemas/*.json
var Schemas embed.FS
