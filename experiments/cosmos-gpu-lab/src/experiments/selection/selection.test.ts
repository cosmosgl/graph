import { expect, it } from 'vitest'
import type { Device } from '@luma.gl/core'
import { createDevice } from '../../gpu/luma'
import { describeEnvironment } from '../../gpu/force-preview'
import { writeArtifact } from '../../testing/artifacts'
import { createSelectionWebGL, createSelectionWebGPU } from './backend'
import { runSelectionTrial, selectionGroups, selectionSeed } from './suite'

it('matches exact ordered rectangle and polygon IDs against the v3.6.0 shaders and the CPU reference', async () => {
  const apis = ['webgl', 'webgpu'] as const
  const canvases = apis.map(() => document.createElement('canvas'))
  const devices: Device[] = []
  const errors: string[] = []
  const rows: Awaited<ReturnType<typeof runSelectionTrial>>[] = []
  const backends: Array<ReturnType<typeof createSelectionWebGL>> = []
  try {
    for (const [i, api] of apis.entries()) {
      const device = await createDevice(api, canvases[i], false, error => { errors.push(`${api}: ${error.message}`) })
      devices.push(device)
      backends.push(api === 'webgl' ? createSelectionWebGL(device) : await createSelectionWebGPU(device))
    }
    for (const group of selectionGroups) {
      for (const trial of group.items) rows.push(await runSelectionTrial(trial.id, backends[0], backends[1]))
    }
  } finally {
    try {
      await writeArtifact('selection-parity', {
        revision: import.meta.env.LAB_SOURCE_REVISION,
        snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
        seed: selectionSeed,
        environments: devices.map((device, i) => describeEnvironment(device, canvases[i])),
        rows,
        errors,
      })
    } finally {
      for (const backend of backends) backend.destroy()
      for (const device of devices) device.destroy()
    }
  }
  expect(errors).toEqual([])
  for (const row of rows) expect(row.status, [row.name, row.detail].filter(Boolean).join(' · ')).toBe('passed')
})
