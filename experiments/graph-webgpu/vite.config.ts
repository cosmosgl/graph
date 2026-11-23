import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export const sharedSource = fileURLToPath(new URL('../../src', import.meta.url))

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone'
  return {
    resolve: { alias: { '@/graph': sharedSource } },
    build: {
      target: 'es2022',
      emptyOutDir: !standalone,
      lib: {
        entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        formats: [standalone ? 'iife' : 'es'],
        name: 'Cosmos',
        fileName: () => standalone ? 'index.min.js' : 'index.js',
      },
      rollupOptions: {
        external: standalone ? [] : [/^@luma\.gl\//],
        output: { inlineDynamicImports: true },
      },
    },
  }
})
