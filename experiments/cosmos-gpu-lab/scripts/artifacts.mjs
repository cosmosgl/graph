import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

// A custom browser command may write only bounded JSON artifacts, never a
// browser-supplied path. The destination is chosen by the local runner/config.
export async function writeLabArtifact ({ project, testPath }, name, json) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(name)) throw new Error('Invalid artifact name')
  if (typeof json !== 'string' || Buffer.byteLength(json) > 32 * 1024 * 1024) throw new Error('Artifact exceeds 32 MiB')
  const data = JSON.parse(json)
  const root = resolve(project.config.root)
  const directory = resolve(root, 'captures', process.env.LAB_ARTIFACT_RUN ?? 'local')
  if (relative(resolve(root, 'captures'), directory).startsWith('..')) throw new Error('Invalid artifact run directory')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, `${name}.json`), JSON.stringify({
    schemaVersion: 1, capturedAt: new Date().toISOString(), test: testPath ? relative(root, testPath) : null, data,
  }, null, 2))
}
