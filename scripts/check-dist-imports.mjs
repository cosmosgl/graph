#!/usr/bin/env node
// The ES build keeps dependencies external, so the consumer's bundler resolves
// them. gl-bench's `browser` entry is an IIFE with no exports: a bare `gl-bench`
// specifier makes bundlers that honor that field (Vite 8 / rolldown) fail with
// `"default" is not exported`. The source imports gl-bench's ES entry by path;
// this check keeps a refactor from quietly reverting to the bare name.
import { readFileSync } from 'node:fs'

const dist = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8')
if (/\b(from|import)\s*["']gl-bench["']/.test(dist)) {
  console.error('dist/index.js imports "gl-bench" by bare name — import gl-bench/dist/gl-bench.module.js instead')
  process.exit(1)
}
console.log('dist imports ok: gl-bench resolves to its ES entry')
