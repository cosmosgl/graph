import { defineConfig } from 'vite'

export default defineConfig({
  appType: 'spa',
  base: './',
  optimizeDeps: { include: ['d3-scale', 'd3-array'] },
})
