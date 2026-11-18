import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { nativeDiagnostics } from './gpu'
import { cpuSums, gravityFixture, sumFixture } from './model'

// An opt-in evidence run, not a performance test or a GPU accuracy threshold.
it.runIf(import.meta.env.LAB_PRECISION_REPLAY)('records the bounded cancellation replay', async () => {
  const count = 1024; const seed = 5931; const fixture = 'cancellation'
  const input = sumFixture(fixture, count)
  const cpu = cpuSums(input)
  const gpu = await nativeDiagnostics(gravityFixture(count, seed), input)
  const values = gpu.sums.map(row => ({
    name: row.name,
    value: Number.isFinite(row.value) ? row.value : String(row.value),
    finite: Number.isFinite(row.value),
  }))
  const cpuControl = cpu.exact === 512 && cpu.serial === 1 && cpu.blocked === 16 && cpu.tree === 512
  const gpuComplete = values.length === 3 && values.every(row => row.finite)
  await writeArtifact('precision-cancellation-replay', {
    experiment: 'precision-diagnostics',
    recipe: '1024-cancellation',
    state: cpuControl && gpuComplete ? 'complete' : 'failed',
    recordedAt: new Date().toISOString(),
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION || null,
    workingTree: import.meta.env.LAB_WORKTREE_STATE || 'Not recorded',
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT || null,
    sourceReproducibility: import.meta.env.LAB_SOURCE_REVISION && import.meta.env.LAB_WORKTREE_STATE === 'clean'
      ? 'Clean revision reported; verify source and environment.'
      : import.meta.env.LAB_SOURCE_REVISION && import.meta.env.LAB_SOURCE_SNAPSHOT
        ? 'Source snapshot reported; verify its contents and environment.'
        : 'Provisional unless an exact source snapshot is retained separately.',
    browser: navigator.userAgent,
    gpuApiImplementation: 'luma-resources-v1',
    adapter: gpu.adapter,
    parameters: { count, seed, fixture },
    cpu,
    gpu: values,
    checks: { cpuControl, gpuComplete },
    limits: [
      'GPU sums are observations; no GPU accuracy or performance threshold is applied.',
      'Gravity, other counts and fixtures, trajectories and production readiness are not assessed by this replay.',
    ],
  })
  expect(cpuControl).toBe(true)
  expect(gpuComplete).toBe(true)
})
