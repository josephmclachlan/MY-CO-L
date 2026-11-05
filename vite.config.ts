import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// MY/CO/L build config.
// The PWA plugin makes the app installable and caches every screen, font and
// sound-free asset so the terminal still opens with no signal at the farm.
// BASE_PATH lets the same app run at the site root (Cloudflare) or under a
// folder such as /MY-CO-L/ (GitHub Pages). The Pages workflow sets it.
const base = process.env.BASE_PATH || '/'
// PREVIEW=1 builds the single-file test copy (no service worker), see scripts/build-preview.mjs.
const preview = process.env.PREVIEW === '1'

export default defineConfig({
  base,
  build: preview ? { outDir: 'dist-preview', assetsInlineLimit: 0 } : undefined,
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
      },
    }),
  ],
})
