/* eslint-disable @typescript-eslint/naming-convention */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import pkg from './package.json'

// Peer dependencies (luma.gl) must stay external in the ES build: bundling a
// private luma copy would defeat the peer-dependency contract — a host sharing
// its Device with cosmos requires both to resolve the same @luma.gl/core.
// The UMD build still bundles everything so the jsdelivr single file stays
// standalone.
const external = [
  ...Object.keys(pkg.dependencies || {}).map((dep) => new RegExp(`^${dep}(/.*)?$`)),
  ...Object.keys(pkg.peerDependencies || {}).map((dep) => new RegExp(`^${dep}(/.*)?$`)),
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
