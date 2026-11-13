import { expect, it } from 'vitest'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS, fixture, point } from './data'
import { compareSnapshots, compareSnapshotsAsync } from './reference'
import { auditContribution, contributionPasses, inspectForeground, runTinyAlphaSweep } from './tiny-alpha'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

it('preserves every audit result when yielding between CPU reference chunks', async () => {
  const image: Snapshot = { width: 32, height: 40, color: new Uint8Array(32 * 40 * 4), ids: new Uint8Array(32 * 40 * 4) }
  const points = [point(16, 20, 0, { size: 20 })]
  image.ids.set([1, 0, 0, 255], (20 * 32 + 16) * 4)
  const other = { ...image, color: image.color.slice() }
  other.color[0] = 3
  const expected = compareSnapshots(image, other, points, DEFAULTS)
  expect(expected.firstWebglInvisiblePick).toBeDefined(); expect(expected.colorFailures).toBe(1)
  expect(await compareSnapshotsAsync(image, other, points, DEFAULTS)).toEqual(expected)
})

it('detects an invisible selected foreground even when the composed-frame audit passes', () => {
  const background: Snapshot = { width: 1, height: 1, color: new Uint8Array([80, 150, 220, 255]), ids: new Uint8Array([1, 0, 0, 255]) }
  const composed = { ...background, ids: new Uint8Array([2, 0, 0, 255]) }
  const isolated = { ...background, color: new Uint8Array(4) }
  const points = [point(0.5, 0.5), point(0.5, 0.5, 0, { color: [1, 1, 1, 1 / 65536] })]
  expect(compareSnapshots(composed, composed, points, DEFAULTS).valid).toBe(true)
  const audit = auditContribution(composed, isolated, 1, background)
  expect(audit).toMatchObject({
    checked: 1,
    invisible: 1,
    paintChangesWithoutForeground: 0,
    first: { x: 0, y: 0, point: 1, sourceAlpha: 0, composedAlpha: 255 },
  })
  expect(contributionPasses({ webgl: audit, webgpu: audit })).toBe(false)
})

it('retains completed sweep rows when cancellation arrives between GPU cases', async () => {
  let stop = false
  const image: Snapshot = { width: 1, height: 1, color: new Uint8Array(4), ids: new Uint8Array(4) }
  const backend: Backend = { info: 'orchestration control', render: async () => image, destroy: () => {} }
  const rows = await runTinyAlphaSweep({ webgl: backend, webgpu: backend }, () => { stop = true }, () => stop)
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ fixture: 'tiny-alpha', ratio: 1, opacity: 0 })
})

it('captures tiny-alpha failures and invisible foregrounds without resizing or replacing the live canvas', async () => {
  const glCanvas = document.createElement('canvas'); const gpuCanvas = document.createElement('canvas')
  const gl = await createStylingWebGL(glCanvas)
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(gpuCanvas)
    const points = fixture('tiny-overlap')
    const before = { webgl: await gl.render(points, DEFAULTS, false, 'explicit'), webgpu: await gpu.render(points, DEFAULTS, false, 'explicit') }
    const settings = { ...DEFAULTS, ratio: 2 }
    const pair = {
      webgl: await gl.render(points, settings, false, 'explicit', false),
      webgpu: await gpu.render(points, settings, false, 'explicit', false),
    }
    expect(pair.webgl.width).toBe(1024); expect(pair.webgpu.height).toBe(640)
    expect([glCanvas.width, glCanvas.height, gpuCanvas.width, gpuCanvas.height]).toEqual([512, 320, 512, 320])
    expect(compareSnapshots(pair.webgl, pair.webgpu, points, settings).valid).toBe(true)
    const audit = await inspectForeground({ webgl: gl, webgpu: gpu }, pair, points, settings, 'explicit')
    for (const lane of ['webgl', 'webgpu'] as const) {
      expect(audit[lane].invisible).toBeGreaterThan(0)
      expect(audit[lane].paintChangesWithoutForeground).toBe(0)
      expect(audit[lane].first?.composedAlpha).toBe(255)
    }
    for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
      const restored = await backend.render(points, DEFAULTS, false, 'explicit')
      expect(restored.color.every((v, i) => v === before[lane].color[i])).toBe(true)
      expect(restored.ids.every((v, i) => v === before[lane].ids[i])).toBe(true)
    }
    const tiny = fixture('tiny-alpha'); const faint = { ...DEFAULTS, opacity: 0.0001 }
    const result = compareSnapshots(await gl.render(tiny, faint, false, 'explicit', false),
      await gpu.render(tiny, faint, false, 'explicit', false), tiny, faint)
    expect(result.webgpuPaintedPixels).toBe(0); expect(result.webgpuInvisiblePicks).toBeGreaterThan(0)
    expect(result.valid).toBe(false)
  } finally { gpu?.destroy(); gl.destroy() }
})
