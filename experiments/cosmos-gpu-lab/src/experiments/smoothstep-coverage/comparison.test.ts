import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { createLinksWebGL } from '../straight-links/webgl'
import { createLinksWebGPU } from '../straight-links/webgpu'
import { fixedInputProbe, FIXED_INPUTS, SMOOTHING } from './fixed-input'
import { compareLine } from './line-study'

it('compares identical runtime inputs and checks the defined ascending formula', async () => {
  const captures = []
  for (const backend of ['webgl', 'webgpu'] as const) {
    const capture = await fixedInputProbe(backend); const { rows } = capture
    captures.push(capture)
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.actualInput).toBe(row.input); expect(row.smoothing).toBe(SMOOTHING)
      if (row.formula === 'ascending') {
        const t = Math.max(0, Math.min(1, (row.input - 0.25) / 0.25))
        const expected = 1 - t * t * (3 - 2 * t)
        expect(Math.abs(row.coverage - expected)).toBeLessThan(0.000001)
      }
    }
    expect(rows.map(row => row.input).sort()).toEqual([...FIXED_INPUTS, ...FIXED_INPUTS].sort())
  }
  await writeArtifact('smoothstep-fixed-input', { browser: navigator.userAgent, captures })
}, 120000)

it('keeps the original line control and reports color and picking changes separately', async () => {
  const run = await compareLine(0, false)
  for (const [lane, create] of [['webgl', createLinksWebGL], ['webgpu', createLinksWebGPU]] as const) {
    const backend = await create(document.createElement('canvas'))
    try {
      const original = await backend.render(run.scene, run.settings, 'visible', false)
      expect(run.snapshots[lane].descending.color).toEqual(original.color)
      expect(run.snapshots[lane].descending.ids).toEqual(original.ids)
      expect(run.samples[lane].descending.carrier).toBe(true)
      for (const formula of ['descending', 'ascending'] as const) {
        const pixel = run.samples[lane][formula]
        if (pixel.picked !== null) expect(pixel.color[3]).toBeGreaterThan(0)
      }
    } finally { backend.destroy() }
  }
  await writeArtifact('smoothstep-line', {
    browser: navigator.userAgent, info: run.info, scene: run.scene, settings: run.settings, samples: run.samples, pair: run.pair, changes: run.changes,
  })
}, 180000)
