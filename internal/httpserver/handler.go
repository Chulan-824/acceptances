package httpserver

import (
	"encoding/json"
	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/buildinfo"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

func New(web fs.FS, app *api.Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "alive"}) })
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if app == nil || app.Ready(r.Context()) != nil {
			respond(w, 503, map[string]string{"status": "not_ready"})
			return
		}
		respond(w, 200, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("GET /api/v1/capabilities", func(w http.ResponseWriter, r *http.Request) {
		info := buildinfo.Current()
		respond(w, 200, map[string]any{"apiVersions": []string{"v1"}, "phase": "local-archive", "version": info.Version, "commit": info.Commit, "build": info})
	})
	if app != nil {
		app.Register(mux)
	}
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { respond(w, 404, map[string]string{"code": "NOT_FOUND"}) })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		if web == nil {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		info, err := fs.Stat(web, name)
		if err != nil || info.IsDir() {
			if !strings.Contains(r.Header.Get("Accept"), "text/html") || strings.HasPrefix(name, "assets/") {
				http.NotFound(w, r)
				return
			}
			name = "index.html"
		}
		http.ServeFileFS(w, r, web, name)
	})
	if app != nil {
		return app.Guard(mux)
	}
	return mux
}
func WebRoot(dir string) (*os.Root, error) { return os.OpenRoot(dir) }
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
