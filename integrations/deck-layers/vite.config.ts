/* eslint-disable @typescript-eslint/naming-convention */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import pkg from './package.json'

// Every peer stays external: the layers must resolve the host's deck.gl,
// luma.gl and @cosmos.gl/graph instances — a Device shared across duplicate
// luma copies is not a supported boundary, and the simulation the layers
// sample belongs to the host application.
const external = [
  ...Object.keys(pkg.peerDependencies || {}).map((dep) => new RegExp(`^${dep}(/.*)?$`)),
]

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    sourcemap: true,
    minify: true,
    rollupOptions: {
      external,
    },
  },
  plugins: [
    dts({
      entryRoot: 'src',
      // The alias below exists so the package builds against live cosmos
      // source; emitted declarations must keep importing the package name.
      aliasesExclude: [/^@cosmos\.gl\/graph/],
    }),
  ],
  resolve: {
    alias: {
      '@cosmos.gl/graph': resolve(__dirname, '../../src/'),
    },
  },
})
