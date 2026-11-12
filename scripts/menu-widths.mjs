// Menu width sweep (12 Nov 2026): every deck name on the main menu must show in full, with no figure running
// past the list and nothing on top of the status board or logo, at every window width from phone to desktop.
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/menu-widths.mjs [http://localhost:4173/]
import { createRequire } from 'node:module'

// Playwright is not a project dependency; this loads a globally installed copy.
const { chromium } = createRequire(import.meta.url)('playwright')

const url = process.argv[2] || 'http://localhost:4173/'
const widths = [360, 390, 600, 700, 701, 720, 760, 800, 820, 860, 900, 950, 1000, 1050, 1100, 1150, 1200, 1280, 1366, 1440, 1600, 1920]
const browser = await chromium.launch()
let bad = 0
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } })
  await page.goto(url)
  for (let i = 0; i < 25 && !(await page.$('.dk-mi-name')); i++) {
    await page.keyboard.press('Space')
    await page.waitForTimeout(600)
  }
  await page.waitForTimeout(1200)
  const r = await page.evaluate(() => {
    const box = (s) => document.querySelector(s)?.getBoundingClientRect()
    const hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const list = box('.dk-menu')
    const items = [...document.querySelectorAll('.dk-mi')].map((e) => e.getBoundingClientRect())
    const names = [...document.querySelectorAll('.dk-mi-name')]
    return {
      decks: names.length,
      cut: names.filter((n) => n.scrollWidth > n.clientWidth + 1 || n.clientWidth < 40).map((n) => n.textContent),
      figsOver: [...document.querySelectorAll('.dk-mi-fig')].filter((f) => f.getBoundingClientRect().right > list.right + 1).length,
      onBoard: items.some((i) => hit(i, box('.fc-board'))),
      onLogo: items.some((i) => hit(i, box('.menu-wire'))),
      sideScroll: document.documentElement.scrollWidth > innerWidth,
    }
  })
  const ok = r.decks > 0 && !r.cut.length && !r.figsOver && !r.onBoard && !r.onLogo && !r.sideScroll
  if (!ok) bad++
  console.log(`${String(w).padStart(5)}px ${ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(r)}`)
  await page.close()
}
await browser.close()
console.log(bad ? `${bad} WIDTHS FAIL` : `ALL ${widths.length} WIDTHS OK`)
process.exit(bad ? 1 : 0)
