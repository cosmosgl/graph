#!/usr/bin/env node
// Sets the same version in every workspace manifest — the root package and
// each integrations/* package. The packages version and publish in lockstep;
// check-lockstep.mjs enforces what this script produces.
//
// Usage: pnpm bump <version>     e.g. pnpm bump 3.5.0 | pnpm bump 3.5.0-beta.2
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The semver.org grammar without build metadata: the release flow publishes
// X.Y.Z and X.Y.Z-<prerelease> only, and check-lockstep compares versions
// verbatim. Validating here stops an invalid version before any manifest is
// rewritten — the registry would reject it only after every prepublish build.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/

const version = process.argv[2]
if (!version || !SEMVER.test(version)) {
  console.error('Usage: pnpm bump <version> — a SemVer version without build metadata, e.g. pnpm bump 3.5.0 or pnpm bump 3.5.0-beta.2')
  process.exit(1)
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const manifestPaths = [join(repoRoot, 'package.json')]
const integrationsDir = join(repoRoot, 'integrations')
if (existsSync(integrationsDir)) {
  for (const entry of readdirSync(integrationsDir)) {
    const manifest = join(integrationsDir, entry, 'package.json')
    if (existsSync(manifest)) manifestPaths.push(manifest)
  }
}

for (const path of manifestPaths) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  const previous = pkg.version
  pkg.version = version
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
  console.warn(`${pkg.name}: ${previous} → ${version}`)
}
