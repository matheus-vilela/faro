import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // jspdf optional peer deps (html(), SVG, sanitization). The app only uses
    // autoTable; Rolldown fails the build if these unresolved imports stay in-graph.
    rollupOptions: {
      external: ["html2canvas", "canvg", "dompurify"],
    },
  },
})
