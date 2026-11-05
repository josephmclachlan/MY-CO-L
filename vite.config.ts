import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

// MY/CO/L build config.
// The PWA plugin makes the app installable and caches every screen, font and
// sound-free asset so the terminal still opens with no signal at the farm.
// BASE_PATH lets the same app run at the site root (Cloudflare) or under a
// folder such as /MY-CO-L/ (GitHub Pages). The Pages workflow sets it.
const base = process.env.BASE_PATH || '/'
// PREVIEW=1 builds the single-file test copy (no service worker), see scripts/build-preview.mjs.
const preview = process.env.PREVIEW === '1'

// MANUAL=1 puts the textbook in the build. Only the private test copy sets it.
// The public build aliases the data to an empty stub, so the textbook text cannot
// end up in it. Remove this gate once the Supabase login serves the manual.
const manual = process.env.MANUAL === '1'
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// The contaminant library, the species facts and the cook log's context notes are paraphrased from the textbook, so their sentences follow the manual's rule:
// they are in the private test copy only. In the public build every fact keeps its id and tags but its
// text (v) and note (n) are emptied here, before bundling. The screens show LOCKED in their place.
const hazardText = (): Plugin => ({
  name: 'hazard-text-gate',
  enforce: 'pre',
  transform(code, id) {
    if (manual || !/\/src\/data\/(hazards|patterns|species|cook)\/[^/]+\.json$/.test(id)) return null
    const strip = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(strip)
      if (x && typeof x === 'object')
        return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ['v', 'n', 'see', 'source'].includes(k) && typeof v === 'string' ? '' : strip(v)]))
      return x
    }
    return { code: JSON.stringify(strip(JSON.parse(code))), map: null }
  },
})

export default defineConfig({
  base,
  define: { __MANUAL__: JSON.stringify(manual) },
  resolve: { alias: { '@manual-data': at(manual ? './src/manual-data/manual.json' : './src/manual/empty.json') } },
  build: preview ? { outDir: 'dist-preview', assetsInlineLimit: 0, rollupOptions: { output: { inlineDynamicImports: true } } } : undefined,
  plugins: [
    hazardText(),
    react(),
    !preview &&
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'MY/CO/L - Mycological Control Lattice',
        short_name: 'MY/CO/L',
        description: 'Farm terminal for Negra Bay Biologics, Talamanca Station.',
        theme_color: '#020a05',
        background_color: '#020a05',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
