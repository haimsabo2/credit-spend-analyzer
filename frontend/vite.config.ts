import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const apiProxy = {
  "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
  "/health": { target: "http://127.0.0.1:8000", changeOrigin: true },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Use 127.0.0.1 so the proxy matches uvicorn on 127.0.0.1 (Windows localhost/IPv6 issues).
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
})
