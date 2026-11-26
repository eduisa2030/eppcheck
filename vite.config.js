import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

// Precarga en el HTML lo que necesita el primer paso (extractor + casco),
// para que la descarga empiece antes de que llegue el JavaScript de la app.
function modelPreload() {
  return {
    name: 'epp-model-preload',
    transformIndexHtml(html, ctx) {
      const manifest = JSON.parse(fs.readFileSync(new URL('./src/lib/modelManifest.json', import.meta.url), 'utf8'))
      const first = manifest.items.casco || Object.values(manifest.items)[0]
      const base = manifest.bases[first.base]
      const links = [base.model, base.weights, first.model, first.weights]
        .map(href => `<link rel="preload" as="fetch" crossorigin="anonymous" href="./${href}" />`)
        .join('\n    ')
      // TensorFlow.js va en un trozo aparte; se pide desde el inicio sin bloquear la pantalla.
      const tfChunk = Object.values(ctx?.bundle || {}).find(chunk => chunk.type === 'chunk' && chunk.name === 'tfjs')
      const tfLink = tfChunk ? `\n    <link rel="modulepreload" crossorigin href="./${tfChunk.fileName}" />` : ''
      return html.replace('<!-- epp-model-preload -->', links + tfLink)
    },
  }
}

export default defineConfig({
  plugins: [react(), modelPreload()],
  base: './',
})
