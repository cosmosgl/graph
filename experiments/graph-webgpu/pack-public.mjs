import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Stage the public name away from the workspace so its WebGL reference and
// the WebGPU candidate can both be built and installed on this branch.
const destination = resolve(process.argv[2] ?? 'dist')
const root = new URL('../../', import.meta.url)
const release = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const { dependencies } = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8'))
const manifest = {
  name: release.name,
  version: release.version,
  private: true,
  type: 'module',
  description: release.description,
  license: release.license,
  repository: release.repository,
  homepage: release.homepage,
  main: release.main,
  types: release.types,
  jsdelivr: release.jsdelivr,
  dependencies: {
    '@luma.gl/graph': dependencies['@luma.gl/graph'],
    // The public declarations expose D3 events, sanitization options and matrices.
    '@types/d3-drag': release.devDependencies['@types/d3-drag'],
    '@types/d3-zoom': release.devDependencies['@types/d3-zoom'],
    dompurify: release.dependencies.dompurify,
    'gl-matrix': release.dependencies['gl-matrix'],
  },
  peerDependencies: {
    '@luma.gl/core': dependencies['@luma.gl/core'],
    '@luma.gl/shaders': dependencies['@luma.gl/shaders'],
    // Luma alpha.14's declarations import the bare math.gl entry. Later
    // versions within luma's allowed range removed it. Deck uses beta.8.
    '@math.gl/core': dependencies['@math.gl/core'],
  },
}

await mkdir(destination, { recursive: true })
const stage = await mkdtemp(join(tmpdir(), 'cosmos-graph-pack-'))
try {
  await mkdir(join(stage, 'dist'))
  for (const name of [manifest.main, manifest.types, manifest.jsdelivr]) {
    await copyFile(new URL(name, import.meta.url), join(stage, name))
  }
  await copyFile(new URL('LICENCE', root), join(stage, 'LICENCE'))
  await copyFile(new URL('CITATION.cff', root), join(stage, 'CITATION.cff'))
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: stage, stdio: 'inherit' })
} finally {
  await rm(stage, { recursive: true, force: true })
}
