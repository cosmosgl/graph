/* eslint-disable @typescript-eslint/naming-convention */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import pkg from './package.json'

const external = [
  ...Object.keys(pkg.dependencies || {}).map((dep) => new RegExp(`^${dep}(/.*)?$`)),
  /d3-/,
]

// eslint-disable-next-line import/no-default-export
export default defineConfig(({ mode }) => {
  const isUMD = mode === 'umd'

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: !isUMD,
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'Cosmos',
        formats: [isUMD ? 'umd' : 'es'],
        fileName: () => (isUMD ? 'index.min.js' : 'index.js'),
      },
      sourcemap: true,
      minify: true,
      rollupOptions: {
        external: isUMD ? [] : external,
        ...(isUMD && {
          output: {
            globals: {
              'd3-selection': 'd3',
              'd3-ease': 'd3',
              'd3-color': 'd3',
              'd3-scale': 'd3',
              'd3-array': 'd3',
              'd3-zoom': 'd3',
              'd3-drag': 'd3',
              'd3-transition': 'd3',
              'gl-matrix': 'glMatrix',
              random: 'random',
            },
          },
        }),
      },
    },
    plugins: isUMD ? [] : [dts({ entryRoot: 'src' })],
    resolve: {
      alias: {
        '@/graph': resolve(__dirname, 'src/'),
        '@cosmos.gl/graph': resolve(__dirname, 'src/'),
      },
    },
  }
})
