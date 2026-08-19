import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    minify: false,
    outDir: fileURLToPath(
      new URL('./dist-electron/electron', import.meta.url),
    ),
    lib: {
      entry: fileURLToPath(new URL('./electron/preload.cts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rolldownOptions: {
      external: ['electron'],
    },
  },
})
