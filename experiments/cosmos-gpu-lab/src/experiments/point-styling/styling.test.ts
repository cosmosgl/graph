import { expect, it } from 'vitest'
import { pick } from './backend'
import { DEFAULTS, fixture, point } from './data'
import { compareSnapshots, referencePick, shapeDistance } from './reference'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

it('uses shape geometry rather than bounding squares and preserves stable IDs in reversed order', () => {
  expect(shapeDistance(0.9, 0.9, 0)).toBeGreaterThan(0)
  for (let shape = 0; shape < 8; shape++) expect(shapeDistance(0, 0, shape)).toBeLessThan(0)
  const points = [point(100, 100), point(100, 100, 1)]
  expect(referencePick(points, DEFAULTS, 100, 100)).toBe(1)
  expect(referencePick(points, { ...DEFAULTS, reverse: true }, 100, 100)).toBe(0)
  for (const changes of [{ size: 0 }, { absent: true }, { color: [1, 1, 1, 0] as [number, number, number, number] }, { shape: 8 }]) {
    expect(referencePick([point(100, 100, 0, changes)], DEFAULTS, 100, 100)).toBeNull()
  }
  for (const id of [0, 254, 255, 65534, 65535, 16777214]) {
    const encoded = id + 1
    const ids = new Uint8Array([encoded & 255, (encoded >> 8) & 255, (encoded >> 16) & 255, 255])
    expect(pick({ width: 1, height: 1, color: new Uint8Array(4), ids }, 0, 0)).toBe(id)
  }
})

it('rejects mismatched IDs, colors and invisible picks independently', () => {
  const points = [point(0.5, 0.5)]
  const painted = { width: 1, height: 1, color: new Uint8Array([255, 0, 0, 255]), ids: new Uint8Array([1, 0, 0, 255]) }
  const missing = { ...painted, color: new Uint8Array(4), ids: new Uint8Array(4) }
  expect(compareSnapshots(painted, missing, points, DEFAULTS)).toMatchObject({
    idDisagreements: 1, webglReferenceFailures: 0, webgpuReferenceFailures: 1, colorFailures: 1, valid: false,
  })
  const invisible = { ...painted, color: new Uint8Array(4) }
  expect(compareSnapshots(invisible, invisible, points, DEFAULTS)).toMatchObject({
    idDisagreements: 0, colorFailures: 0, webglInvisiblePicks: 1, webgpuInvisiblePicks: 1, valid: false,
  })
})

it('compares production styling, exact pick masks and visual alpha across frozen settings', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const [name, changes] of [
      ['shapes', {}], ['shapes', { ratio: 2 }], ['shapes', { zoom: 0.5 }], ['shapes', { zoom: 2, scaleOnZoom: false }],
      ['overlap', {}], ['overlap', { reverse: true }], ['overlap', { opacity: 0.35 }], ['edge-cases', {}],
      ['shapes', { zoom: 2 }], ['overlap', { ratio: 2, reverse: true }],
      ['edge-cases', { ratio: 2 }], ['edge-cases', { defaultSize: 54, defaultStroke: 8, sizeScale: 0.5 }],
    ] as const) {
      const settings = { ...DEFAULTS, ...changes }; const points = fixture(name)
      const a = await gl.render(points, settings); const b = await gpu.render(points, settings)
      const comparison = compareSnapshots(a, b, points, settings)
      expect(comparison, `${name} ${JSON.stringify(changes)} ${JSON.stringify(comparison)}`).toMatchObject({
        idDisagreements: 0,
        webglReferenceFailures: 0,
        webgpuReferenceFailures: 0,
        colorFailures: 0,
        webglInvisiblePicks: 0,
        webgpuInvisiblePicks: 0,
        valid: true,
      })
    }
    // A pixel at a circle's bounding-box corner is neither rendered nor picked.
    const isolated = await gpu.render([point(100, 100)], DEFAULTS)
    expect(pick(isolated, 119, 119)).toBeNull(); expect(pick(isolated, 100, 100)).toBe(0)
    expect(pick(isolated, -1, 0)).toBeNull()
    const hidden = { ...DEFAULTS, opacity: 0 }; const points = fixture('shapes')
    const regression = compareSnapshots(await gl.render(points, hidden), await gpu.render(points, hidden), points, hidden)
    expect(regression.idDisagreements).toBe(0)
    expect(regression.webglInvisiblePicks).toBeGreaterThan(0); expect(regression.webgpuInvisiblePicks).toBeGreaterThan(0)
    expect(regression.valid).toBe(false)
    // Direct visible/pickable coverage check, independent of the scalar mask:
    // opaque isolated shapes must select exactly their >= half-alpha pixels.
    for (let shape = 0; shape < 8; shape++) {
      for (const backend of [gl, gpu]) {
        const snapshot = await backend.render([point(100, 100, shape)], DEFAULTS)
        let failures = 0
        for (let i = 0; i < snapshot.width * snapshot.height; i++) {
          const painted = snapshot.color[i * 4 + 3] >= 128
          const selected = pick(snapshot, i % snapshot.width, Math.floor(i / snapshot.width)) !== null
          if (painted !== selected) failures++
        }
        expect(failures, `shape ${shape}: half-alpha versus picked mask`).toBe(0)
      }
    }
    // Exercise GPU RGB carry boundaries, not only the CPU decoder. Absent
    // prefix records carry stable identity without contributing any fragments.
    const ids = Array.from({ length: 65537 }, () => point(0, 0, 0, { absent: true }))
    ids[255] = point(100, 100); ids[65535] = point(200, 100); ids[65536] = point(300, 100)
    for (const backend of [gl, gpu]) {
      const snapshot = await backend.render(ids, DEFAULTS)
      expect(pick(snapshot, 100, 100)).toBe(255); expect(pick(snapshot, 200, 100)).toBe(65535)
      expect(pick(snapshot, 300, 100)).toBe(65536)
    }
  } finally { gpu?.destroy(); gl.destroy() }
})

it('checks fractional pick visibility while retaining unaccepted geometry and color differences', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const ratio of [1, 2]) {
      const settings = { ...DEFAULTS, ratio }; const points = fixture('fractional')
      const comparison = compareSnapshots(await gl.render(points, settings), await gpu.render(points, settings), points, settings)
      expect(comparison.webglInvisiblePicks).toBe(0)
      expect(comparison.webgpuInvisiblePicks).toBe(0)
      // This is a diagnostic report, not a universal requirement for WebGL to fail.
      // The live UI retains every color/ID failure and rejects cross-backend parity.
    }
  } finally { gpu?.destroy(); gl.destroy() }
})
