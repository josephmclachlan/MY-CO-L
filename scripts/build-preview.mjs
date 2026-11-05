// Builds a single self-contained HTML file of the app for a private test link
// (a claude.ai page), so new screens can be tried on a phone before merging.
// Usage: npm run build:preview  ->  dist-preview/mycol-preview.html
// No service worker or install in this copy; everything else works, in LOCAL MODE.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

execSync('npx vite build', {
  stdio: 'inherit',
  env: { ...process.env, PREVIEW: '1', BASE_PATH: './', VITE_SUPABASE_URL: '', VITE_SUPABASE_KEY: '' },
})

const dir = 'dist-preview'
const assets = join(dir, 'assets')
const files = readdirSync(assets)
const mime = { woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', svg: 'image/svg+xml' }

let css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n')
css = css.replace(/url\(\s*["']?(?:\.\/|\/assets\/|assets\/)?([^"')]+\.(woff2?|png|svg))["']?\s*\)/g, (m, name, ext) => {
  const file = files.find((f) => f === name.split('/').pop())
  if (!file) return m
  return `url(data:${mime[ext]};base64,${readFileSync(join(assets, file)).toString('base64')})`
})
const js = files
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(assets, f), 'utf8'))
  .join('\n')
  .replace(/<\/script/gi, '<\\/script')

// The claude.ai page wraps this in its own <html>/<head>/<body>, so we write only the content.
const page = `<title>MY/CO/L</title>
<meta name="theme-color" content="#020a05">
<style>:root{color-scheme:dark}body{background:#000}</style>
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`
writeFileSync(join(dir, 'mycol-preview.html'), page)
console.log(`wrote ${join(dir, 'mycol-preview.html')} (${(page.length / 1024).toFixed(0)} KB)`)
