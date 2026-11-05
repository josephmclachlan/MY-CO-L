// Turns the textbook chapters (Markdown + SVG figures) into one JSON file for the
// MANUAL screen. PRIVATE TEST COPY ONLY: the output (src/manual-data/manual.json)
// is gitignored and the public Pages build never imports it (see vite.config.ts).
// Usage: MANUAL_SRC=/path/to/textbook node scripts/build-manual.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'

const SRC = process.env.MANUAL_SRC || '/mnt/project-files/knowledge/01-core-knowledge/textbook'
if (!existsSync(join(SRC, 'chapters'))) {
  console.error(`Textbook not found at ${SRC}. Set MANUAL_SRC to the textbook folder.`)
  process.exit(1)
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const files = readdirSync(join(SRC, 'chapters')).filter((f) => /^t\d\d-.*\.md$/.test(f)).sort()

const chapters = []
const factMap = {} // fact id -> [anchor, ...]
const anchors = {} // anchor id -> chapter index

files.forEach((file, ci) => {
  let md = readFileSync(join(SRC, 'chapters', file), 'utf8').replace(/\r/g, '')
  // The build hides "Omitted from v1".
  md = md.replace(/\n## Omitted from v1[\s\S]*$/, '\n')

  let curAnchor = null
  const toc = []
  let chTitle = file
  const out = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    // figure spec block
    if (line.startsWith('```figure')) {
      const spec = {}
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        const m = /^(\w+):\s*(.*)$/.exec(lines[i])
        if (m) spec[m[1]] = m[2]
        i++
      }
      const id = spec.id || ''
      const svgFile = join(SRC, 'figures', id + '.svg')
      let inner = ''
      if (id && existsSync(svgFile)) {
        inner = readFileSync(svgFile, 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/g, '').replace(/<\?xml[^>]*\?>/, '').replace(/\s*\n\s*/g, ' ').trim()
        inner = inner.replace(/<svg /, '<svg role="img" aria-label="' + esc(spec.title || id).replace(/"/g, '&quot;') + '" ')
      } else {
        inner = `<div class="mfig-ph">FIGURE NOT DRAWN YET<br>${esc(spec.title || id)}</div>`
      }
      out.push('', `<figure class="mfig" id="${id}">${inner}<figcaption><b>${esc(spec.title || '')}.</b> ${esc(spec.caption || '')}</figcaption></figure>`, '')
      continue
    }
    const h = /^(#{1,4}) (.*?)\s*\{#([a-z0-9-]+)\}\s*$/.exec(line)
    if (h) {
      const level = h[1].length
      const title = h[2]
      const id = h[3]
      curAnchor = id
      anchors[id] = ci
      if (level === 1) chTitle = title.replace(/\*+/g, '')
      else if (level <= 3) toc.push({ id, title: title.replace(/[*`]/g, ''), level })
      line = `<h${level} id="${id}">${marked.parseInline(title)}</h${level}>`
      out.push('', line, '')
      continue
    }
    // fact markers
    line = line.replace(/\{\{omit[^}]*\}\}/g, '').replace(/\{\{([^}]*)\}\}/g, (_, ids) => {
      const list = ids.trim().split(/\s+/).filter((x) => /^F\d\d-\d{4}$/.test(x))
      for (const f of list) {
        const a = (factMap[f] ||= [])
        if (curAnchor && !a.includes(curAnchor)) a.push(curAnchor)
      }
      return list.length ? `<span class="fm" data-f="${list.join(' ')}"></span>` : ''
    })
    out.push(line)
  }

  let html = marked.parse(out.join('\n'), { gfm: true, breaks: false })
  // ids on glossary spans
  for (const m of html.matchAll(/id="([a-z0-9-]+)"/g)) if (!(m[1] in anchors)) anchors[m[1]] = ci
  // callouts: blockquote whose first word is a bold label
  html = html.replace(/<blockquote>\s*<p><strong>([A-Z ]+):<\/strong>/g, (_, label) => `<blockquote class="co co-${label.toLowerCase().replace(/\s+/g, '-')}"><p><strong class="colabel">${label}</strong>`)
  html = html.replace(/<table>/g, '<div class="tbl"><table>').replace(/<\/table>/g, '</table></div>')
  const id = file.slice(0, 3)
  chapters.push({ id, title: chTitle, num: Number(id.slice(1)), toc, html })
})

mkdirSync('src/manual-data', { recursive: true })
writeFileSync('src/manual-data/manual.json', JSON.stringify({ chapters, factMap, anchors }))
const kb = Math.round(JSON.stringify({ chapters, factMap, anchors }).length / 1024)
console.log(`manual: ${chapters.length} chapters, ${Object.keys(factMap).length} fact ids, ${Object.keys(anchors).length} anchors, ${kb} KB`)
