import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeLabArtifact } from './artifacts.mjs'

test('captures changing measurements without golden snapshots and rejects unsafe output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lab-artifacts-'))
  const context = { project: { config: { root } }, testPath: join(root, 'cost.test.ts') }
  const previous = process.env.LAB_ARTIFACT_RUN
  process.env.LAB_ARTIFACT_RUN = 'test-run'
  try {
    await writeLabArtifact(context, 'cost', '{"ms":1}')
    await writeLabArtifact(context, 'cost', '{"ms":2}')
    const result = JSON.parse(await readFile(join(root, 'captures/test-run/cost.json'), 'utf8'))
    assert.deepEqual(result.data, { ms: 2 })
    assert.equal(result.test, 'cost.test.ts')
    assert.ok(Number.isFinite(Date.parse(result.capturedAt)))
    await assert.rejects(writeLabArtifact(context, '../escape', '{}'))
    await assert.rejects(writeLabArtifact(context, 'bad-json', 'invalid'))
    await assert.rejects(writeLabArtifact(context, 'oversized', ' '.repeat(32 * 1024 * 1024 + 1)))
    process.env.LAB_ARTIFACT_RUN = '../../escape'
    await assert.rejects(writeLabArtifact(context, 'cost', '{}'))
  } finally {
    if (previous === undefined) delete process.env.LAB_ARTIFACT_RUN
    else process.env.LAB_ARTIFACT_RUN = previous
    await rm(root, { recursive: true, force: true })
  }
})
