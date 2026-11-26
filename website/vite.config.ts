import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { defineConfig } from 'vite'

// Workspace development can use Graph before its first build. An installed
// public package must resolve its own entry, including in a packed-site check.
const installedGraph = new URL('./node_modules/@cosmos.gl/graph', import.meta.url)
const workspaceGraph = existsSync(installedGraph) && realpathSync(installedGraph) === realpathSync(new URL('../', import.meta.url))

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
      ...(workspaceGraph ? { '@cosmos.gl/graph': fileURLToPath(new URL('../src/index.ts', import.meta.url)) } : {}),
      '@/graph': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
})
