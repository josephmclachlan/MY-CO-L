// Writes docs/USER-MANUAL.md from the guide text. Run with: npm run docs:guide
import { writeFileSync } from 'node:fs'
import { guideMarkdown } from '../src/guide/markdown'

writeFileSync(new URL('../docs/USER-MANUAL.md', import.meta.url), guideMarkdown())
console.log('docs/USER-MANUAL.md written')
