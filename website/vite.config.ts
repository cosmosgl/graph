import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        iframe: fileURLToPath(new URL('./iframe.html', import.meta.url)),
        ...Object.fromEntries(readdirSync(new URL('./examples/', import.meta.url)).map(id =>
          [`example-${id}`, fileURLToPath(new URL(`./examples/${id}/index.html`, import.meta.url))]
        )),
      },
    },
  },
  resolve: {
    alias: {
      '@cosmos.gl/graph': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      '@/graph': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
})
