import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Stage the public name away from the workspace so its WebGL reference and
// the WebGPU candidate can both be built and installed on this branch.
const destination = resolve(process.argv[2] ?? 'dist')
const root = new URL('../../', import.meta.url)
const release = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
// The native Deck 10 alpha.1 host requires this exact peer family. The ES
// bundle leaves every luma import external, including the WebGPU adapter.
const lumaVersion = '10.0.0-alpha.14'
const manifest = {
  name: release.name,
  version: release.version,
  private: true,
  type: 'module',
  license: release.license,
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  dependencies: {
    '@luma.gl/graph': lumaVersion,
    // The public declarations expose D3 events, sanitization options and matrices.
    '@types/d3-drag': release.devDependencies['@types/d3-drag'],
    '@types/d3-zoom': release.devDependencies['@types/d3-zoom'],
    dompurify: release.dependencies.dompurify,
    'gl-matrix': release.dependencies['gl-matrix'],
  },
  peerDependencies: {
    '@luma.gl/core': lumaVersion,
    '@luma.gl/shaders': lumaVersion,
    // Luma alpha.14's declarations import the bare math.gl entry. Later
    // versions within luma's allowed range removed it. Deck uses beta.8.
    '@math.gl/core': '5.0.0-beta.8',
  },
}

await mkdir(destination, { recursive: true })
const stage = await mkdtemp(join(tmpdir(), 'cosmos-graph-pack-'))
try {
  await mkdir(join(stage, 'dist'))
  for (const name of ['index.js', 'index.d.ts']) {
    await copyFile(new URL(`dist/${name}`, import.meta.url), join(stage, 'dist', name))
  }
  await copyFile(new URL('LICENCE', root), join(stage, 'LICENCE'))
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: stage, stdio: 'inherit' })
} finally {
  await rm(stage, { recursive: true, force: true })
}
