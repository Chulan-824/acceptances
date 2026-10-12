import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8765", changeOrigin: false },
      "/health": { target: "http://127.0.0.1:8765", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    rolldownOptions: {
      input: {
        app: new URL("./index.html", import.meta.url).pathname,
        landing: new URL("./landing.html", import.meta.url).pathname,
      },
    },
  },
});
