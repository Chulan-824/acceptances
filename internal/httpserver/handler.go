package httpserver

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/Chulan-824/acceptances/internal/buildinfo"
)

func New(web fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "alive"})
	})
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "code": "FOUNDATION_ONLY"})
	})
	mux.HandleFunc("GET /api/v1/capabilities", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, buildinfo.Current())
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusNotFound, map[string]string{"code": "NOT_FOUND"})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
			// 仅页面导航回退到 SPA，缺失资源仍返回 404。
			if !strings.Contains(r.Header.Get("Accept"), "text/html") || strings.HasPrefix(name, "assets/") {
				http.NotFound(w, r)
				return
			}
			name = "index.html"
		}
		http.ServeFileFS(w, r, web, name)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}

// WebRoot 使用受限根目录，避免符号链接越过构建产物目录。
func WebRoot(dir string) (*os.Root, error) { return os.OpenRoot(dir) }

func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
