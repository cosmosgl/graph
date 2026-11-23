import type { LiveCheckGroup } from '../../runtime/live-checks'
import { createSpatialGridBackend } from './backend'
import { createCpuGridReference, createGridPositions, validateGrid, type GridValidation } from './reference'

export const gridTrials = [
  {
    distribution: 'uniform',
    pointCount: 100_000,
    gridSize: 32,
    builds: 1,
    description: 'Check cell counts and ranges when points are spread across the grid.',
  },
  {
    distribution: 'diagonal',
    pointCount: 65_537,
    gridSize: 257,
    builds: 2,
    description: 'Move points across cells, then rebuild all three scan levels on the same buffers.',
  },
  {
    distribution: 'clusters',
    pointCount: 5_000_000,
    gridSize: 256,
    builds: 1,
    description: 'Check that points competing for the same cell each receive a distinct slot.',
    recordedOnly: true,
  },
] as const

type GridTrial = typeof gridTrials[number]
export const gridGroups: LiveCheckGroup[] = [{
  heading: 'Does every point appear once in the correct cell?',
  items: gridTrials.map(trial => {
    const { distribution, pointCount, gridSize, description } = trial
    return {
      id: distribution,
      title: `${pointCount.toLocaleString('en-US')} ${distribution === 'clusters' ? 'clustered' : distribution} points · ${gridSize} × ${gridSize}`,
      description,
      recorded: 'passed',
      recordedOnly: 'recordedOnly' in trial && trial.recordedOnly,
    }
  }),
}]

type GridRecord = {
  browser: string; device?: string; distribution: string; pointCount: number; gridSize: number;
  scan: number[]; results: GridValidation[]; errors: string[];
}

export async function runGridTrial (
  trial: GridTrial, record?: (data: GridRecord) => Promise<void>, signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const { distribution, pointCount, gridSize, builds } = trial
  const positions = createGridPositions(pointCount, distribution)
  positions.set([-1, -1, 1, 1, -2, 2, 2, -2])
  const errors: string[] = []
  const results: GridValidation[] = []
  const grid = await createSpatialGridBackend(positions, gridSize, error => { errors.push(error.message) }, signal)
  try {
    for (let build = 0; build < builds; build++) {
      signal?.throwIfAborted()
      if (build > 0) {
        // Reflect the diagonal across the x axis, keeping the four corner probes fixed.
        for (let i = 9; i < positions.length; i += 2) positions[i] = -positions[i]
        grid.updatePositions(positions)
      }
      const expected = createCpuGridReference(positions, gridSize)
      await grid.build()
      signal?.throwIfAborted()
      const { counts, offsets, pointIndices } = await grid.readback()
      signal?.throwIfAborted()
      const result = validateGrid(positions, gridSize, expected, counts, offsets, pointIndices)
      results.push(result)
      if (offsets[gridSize ** 2] !== pointCount) throw new Error(`Final cell offset differs from ${pointCount}.`)
      if (!result.valid) throw new Error(`Grid mismatch on build ${build + 1}: ${JSON.stringify(result)}`)
      const corners = [0, gridSize ** 2 - 1, gridSize * (gridSize - 1), gridSize - 1]
      for (const [point, cell] of corners.entries()) {
        if (!pointIndices.subarray(offsets[cell], offsets[cell + 1]).includes(point)) throw new Error(`Corner point ${point} missing from cell ${cell}.`)
      }
    }
  } finally {
    try { await grid.waitForIdle() } finally {
      grid.destroy()
      await record?.({ browser: navigator.userAgent, device: grid.info, distribution, pointCount, gridSize, scan: grid.scanHierarchy, results, errors })
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
}
