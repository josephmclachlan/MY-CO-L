// Bundles the sensor bridge into one plain file (bridge.mjs) that Node runs with no install step.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  publicDir: false,
  build: {
    ssr: fileURLToPath(new URL('./bridge.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('.', import.meta.url)),
    emptyOutDir: false,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'bridge.mjs', format: 'es' } },
  },
  ssr: { noExternal: true },
})
