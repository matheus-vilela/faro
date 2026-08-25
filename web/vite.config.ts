import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const JSPDF_OPTIONAL_DEPS = ["html2canvas", "canvg", "dompurify"] as const

/** jspdf optional peers used only by html()/SVG APIs — the app uses autoTable. */
function stubJspdfOptionalDeps(): Plugin {
  const virtual = (id: string) => `\0jspdf-optional:${id}`
  return {
    name: "stub-jspdf-optional-deps",
    enforce: "pre",
    resolveId(id) {
      if ((JSPDF_OPTIONAL_DEPS as readonly string[]).includes(id)) {
        return virtual(id)
      }
    },
    load(id) {
      if (id.startsWith("\0jspdf-optional:")) {
        return "export default {}"
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [stubJspdfOptionalDeps(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
