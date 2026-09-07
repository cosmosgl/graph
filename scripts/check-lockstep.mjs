#!/usr/bin/env node
// Every workspace manifest must carry the same version: the packages publish
// in lockstep, and `pnpm -r publish` only ships versions not yet on the
// registry — a partial bump would silently publish a partial set. Runs from
// every package's prepublishOnly and from CI; fix drift with `pnpm bump`.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const manifestPaths = [join(repoRoot, 'package.json')]
const integrationsDir = join(repoRoot, 'integrations')
if (existsSync(integrationsDir)) {
  for (const entry of readdirSync(integrationsDir)) {
    const manifest = join(integrationsDir, entry, 'package.json')
    if (existsSync(manifest)) manifestPaths.push(manifest)
  }
}

const packages = manifestPaths.map((path) => {
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  return { name: pkg.name, version: pkg.version }
})

const versions = new Set(packages.map((pkg) => pkg.version))
if (versions.size > 1) {
  console.error('Workspace versions have drifted — the packages publish in lockstep:')
  for (const pkg of packages) console.error(`  ${pkg.name}@${pkg.version}`)
  console.error('Run `pnpm bump <version>` to set one version everywhere.')
  process.exit(1)
}

console.warn(`lockstep ok: ${packages.map((pkg) => pkg.name).join(', ')} all at ${packages[0].version}`)
