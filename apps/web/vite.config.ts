import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiOrigin = `http://127.0.0.1:${process.env.ACCEPTANCES_DEV_API_PORT || "8765"}`;

export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: apiOrigin, changeOrigin: false },
      "/health": { target: apiOrigin, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // 共享 diff 依赖独立打包，避免渲染器回引重试前的预览模块 URL。
              name: "diff-shared",
              test: /node_modules\/@pierre\/diffs\//,
              entriesAware: true,
            },
          ],
        },
      },
      input: {
        app: new URL("./index.html", import.meta.url).pathname,
        landing: new URL("./landing.html", import.meta.url).pathname,
      },
    },
  },
});
