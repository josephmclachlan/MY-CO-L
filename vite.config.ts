import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// MY/CO/L build config.
// The PWA plugin makes the app installable and caches every screen, font and
// sound-free asset so the terminal still opens with no signal at the farm.
// BASE_PATH lets the same app run at the site root (Cloudflare) or under a
// folder such as /MY-CO-L/ (GitHub Pages). The Pages workflow sets it.
const base = process.env.BASE_PATH || '/'
// PREVIEW=1 builds the single-file test copy (no service worker), see scripts/build-preview.mjs.
const preview = process.env.PREVIEW === '1'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Nothing is private for now (Joseph, 11 Nov 2026): every build carries the textbook (the MANUAL
// screen and every WHY? > READ SECTION link) and all the textbook sentences in the data files.
// Locked access comes later, with the self-hosted farm box and a private repo.
// The textbook data is src/manual-data/manual.json (npm run manual rebuilds it from the chapters).
// MANUAL=0 leaves it out; a copy without the file shows MANUAL LOCKED.
const manualFile = at('./src/manual-data/manual.json')
const manual = process.env.MANUAL !== '0' && existsSync(manualFile)

export default defineConfig({
  base,
  define: { __MANUAL__: JSON.stringify(manual) },
  resolve: { alias: { '@manual-data': manual ? manualFile : at('./src/manual/empty.json') } },
  build: preview ? { outDir: 'dist-preview', assetsInlineLimit: 0, rollupOptions: { output: { inlineDynamicImports: true } } } : undefined,
  plugins: [
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
        // The main script is about 2.1 MB once a database address is set (Supabase or the farm box), just over
        // Workbox's 2 MiB default, which would leave it out of the offline copy (and fails the build).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
})
