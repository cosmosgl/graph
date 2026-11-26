import { defineConfig } from 'vite'

export default defineConfig({
  appType: 'spa',
  build: { rollupOptions: { input: ['index.html', 'production-viewer.html'] } },
  base: './',
  optimizeDeps: { include: ['d3-scale', 'd3-array'] },
})
