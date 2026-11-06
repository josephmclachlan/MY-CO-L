// Makes the farm-box download: dist-selfhost/mycol-selfhost.tar.gz
//   mycol-selfhost/app/         the app, built to find its data and login at its own address (VITE_SUPABASE_URL=self)
//   mycol-selfhost/migrations/  the database changes (supabase/migrations)
//   mycol-selfhost/selfhost/    docker-compose.yml, Caddyfile, mycol.sh, db/, bridge/bridge.mjs
//   mycol-selfhost/VERSION      date and commit
// The GitHub workflow .github/workflows/selfhost.yml runs this on every merge and attaches the file to the
// "selfhost-latest" release, which ./mycol.sh update downloads.
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } })
const out = 'dist-selfhost'
const pkg = `${out}/mycol-selfhost`
rmSync(out, { recursive: true, force: true })

run(`npx tsc -b && npx vite build --outDir ${pkg}/app --emptyOutDir`, { BASE_PATH: '/', VITE_SUPABASE_URL: 'self', VITE_SUPABASE_KEY: 'self-hosted' })
run('npx vite build --config selfhost/bridge/vite.config.ts')

cpSync('supabase/migrations', `${pkg}/migrations`, { recursive: true })
mkdirSync(`${pkg}/selfhost/db`, { recursive: true })
mkdirSync(`${pkg}/selfhost/bridge`, { recursive: true })
for (const f of ['docker-compose.yml', 'Caddyfile', 'mycol.sh', '.env.example', 'db/00-roles.sh', 'bridge/bridge.mjs'])
  cpSync(`selfhost/${f}`, `${pkg}/selfhost/${f}`)
let commit = 'local'
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  /* not a git folder */
}
writeFileSync(`${pkg}/VERSION`, `${new Date().toISOString().slice(0, 10)} ${commit}\n`)
run(`tar -czf ${out}/mycol-selfhost.tar.gz -C ${out} mycol-selfhost`)
console.log(`\nMade ${out}/mycol-selfhost.tar.gz`)
