import { execFileSync } from 'node:child_process'
import { access, copyFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Compile the shared layer against the same Graph tarball the application
// will install. Workspace resolution would pick the reference Graph and Deck.
const root = new URL('../../', import.meta.url)
const release = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8'))
const destination = resolve(process.argv[2] ?? 'dist')
const graphTarball = join(destination, `cosmos.gl-graph-${release.version}.tgz`)
await access(graphTarball)

const peerDependencies = {
  '@cosmos.gl/graph': release.version,
  '@deck.gl/core': '10.0.0-alpha.1',
  '@luma.gl/core': '10.0.0-alpha.14',
}
const manifest = {
  name: release.name,
  version: release.version,
  private: true,
  type: 'module',
  license: release.license,
  sideEffects: false,
  files: ['dist'],
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  peerDependencies,
}

const stage = await mkdtemp(join(tmpdir(), 'cosmos-deck-pack-'))
try {
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  // Install the packed candidate explicitly. Its public name and version are
  // shared by the WebGL release on npm during the migration.
  execFileSync('npm', [
    'install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', graphTarball,
  ], { cwd: stage, stdio: 'inherit' })
  await cp(new URL('src', import.meta.url), join(stage, 'src'), {
    recursive: true,
    filter: (source) => basename(source) !== 'stories',
  })
  await copyFile(new URL('experiments/graph-webgpu/deck-layers/graph-host.ts', root), join(stage, 'src/graph-host.ts'))
  await copyFile(new URL('LICENCE', root), join(stage, 'LICENCE'))
  await writeFile(join(stage, 'tsconfig.json'), JSON.stringify({
    extends: fileURLToPath(new URL('tsconfig.json', root)),
    compilerOptions: { baseUrl: '.', paths: {}, rootDir: 'src', outDir: 'dist', noEmitOnError: true },
    include: ['src'],
  }))
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  execFileSync(process.execPath, [tsc, '--project', 'tsconfig.json'], { cwd: stage, stdio: 'inherit' })
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', destination], { cwd: stage, stdio: 'inherit' })
} finally {
  await rm(stage, { recursive: true, force: true })
}
