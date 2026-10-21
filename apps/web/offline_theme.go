// Package webassets supplies the web theme to independently readable HTML exports.
package webassets

import (
	_ "embed"
	"encoding/base64"
	"strings"
)

//go:embed src/theme.css
var theme string

//go:embed public/fonts/geist/Geist-Variable.woff2
var sans []byte

//go:embed public/fonts/geist/Geist-Italic-Variable.woff2
var sansItalic []byte

//go:embed public/fonts/geist/GeistMono-Variable.woff2
var mono []byte

//go:embed public/fonts/geist/GeistMono-Italic-Variable.woff2
var monoItalic []byte

//go:embed public/fonts/geist/OFL.txt
var FontLicense string

// OfflineThemeCSS uses the same tokens and font bytes as the application, with
// native CSS declarations and data URLs so downloaded documents need no server.
var OfflineThemeCSS = offlineThemeCSS()

func offlineThemeCSS() string {
	css := strings.NewReplacer("@theme static", ":root", "@theme inline", ":root").Replace(theme)
	for _, font := range []struct {
		name string
		data []byte
	}{
		{"Geist-Variable.woff2", sans},
		{"Geist-Italic-Variable.woff2", sansItalic},
		{"GeistMono-Variable.woff2", mono},
		{"GeistMono-Italic-Variable.woff2", monoItalic},
	} {
		css = strings.ReplaceAll(css, "/fonts/geist/"+font.name, "data:font/woff2;base64,"+base64.StdEncoding.EncodeToString(font.data))
	}
	return css
}
