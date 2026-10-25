package prd

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

var documentToken = regexp.MustCompile("^[A-Za-z0-9_-]{6,200}$")

func NormalizeURL(raw string) (SourceURL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Opaque != "" || u.RawPath != "" || u.Port() != "" && u.Port() != "443" {
		return SourceURL{}, errors.New("unsupported Lark document URL")
	}
	host := strings.ToLower(u.Hostname())
	realm := ""
	for domain, region := range map[string]string{"feishu.cn": "feishu", "larksuite.com": "lark"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			realm = region
		}
	}
	parts := strings.Split(strings.TrimSuffix(u.Path, "/"), "/")
	if realm == "" || len(parts) != 3 || parts[1] != "docx" && parts[1] != "wiki" || !documentToken.MatchString(parts[2]) {
		return SourceURL{}, errors.New("unsupported Lark document URL")
	}
	u.Host, u.Path = host, "/"+parts[1]+"/"+parts[2]
	u.RawQuery, u.Fragment, u.RawFragment, u.ForceQuery = "", "", "", false
	return SourceURL{URL: u.String(), Realm: realm, Kind: parts[1], Token: parts[2]}, nil
}
