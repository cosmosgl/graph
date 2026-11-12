import { expect, it } from 'vitest'
import { pick } from './backend'
import { DEFAULTS, fixture, point } from './data'
import { compareSnapshots, referencePick, shapeDistance } from './reference'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { investigateFractional } from './fractional'
import { BOUNDARY_PIXELS } from './explicit'

const STYLING_CASES = [
  ['shapes', {}], ['shapes', { ratio: 2 }], ['shapes', { zoom: 0.5 }], ['shapes', { zoom: 2, scaleOnZoom: false }],
  ['overlap', {}], ['overlap', { reverse: true }], ['overlap', { opacity: 0.35 }], ['edge-cases', {}],
  ['shapes', { zoom: 2 }], ['overlap', { ratio: 2, reverse: true }],
  ['edge-cases', { ratio: 2 }], ['edge-cases', { defaultSize: 54, defaultStroke: 8, sizeScale: 0.5 }],
] as const

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

it('declares candidate visibility independently of the unchanged legacy reference', () => {
  const points = [point(0.5, 0.5)]; const hidden = { ...DEFAULTS, opacity: 0 }
  expect(referencePick(points, hidden, 0.5, 0.5)).toBeNull()
  expect(referencePick(points, hidden, 0.5, 0.5, 'legacy')).toBe(0)
  for (const opacity of [0.35, 1]) expect(referencePick(points, { ...DEFAULTS, opacity }, 0.5, 0.5)).toBe(0)
  const blank = { width: 1, height: 1, color: new Uint8Array(4), ids: new Uint8Array(4), pickingRule: 'visible' as const }
  const legacy = { ...blank, ids: new Uint8Array([1, 0, 0, 255]), pickingRule: 'legacy' as const }
  expect(compareSnapshots(blank, blank, points, hidden)).toMatchObject({
    valid: true, webglPickedPixels: 0, webgpuPickedPixels: 0, webglReferenceFailures: 0, webgpuReferenceFailures: 0,
  })
  expect(compareSnapshots(legacy, blank, points, hidden)).toMatchObject({
    valid: false,
    pickingRules: { webgl: 'legacy', webgpu: 'visible' },
    idDisagreements: 1,
    webglReferenceFailures: 0,
    webgpuReferenceFailures: 0,
    webglInvisiblePicks: 1,
    webgpuInvisiblePicks: 0,
    firstIdMismatch: { expected: { webgl: 0, webgpu: null } },
  })
})

it('keeps exact sprite-boundary omissions as failures against the original closed CPU mask', () => {
  const points = [point(10.5, 10.5, 0, { size: 2 })]
  const color = new Uint8Array(20 * 20 * 4); const ids = color.slice()
  // Include left/bottom and exclude top/right, matching the sprite boundary.
  for (const [x, y] of [[9, 10], [10, 10], [10, 11]]) {
    const offset = (y * 20 + x) * 4
    color.set([255, 255, 255, 255], offset); ids.set([1, 0, 0, 255], offset)
  }
  const snapshot = { width: 20, height: 20, color, ids }
  expect(compareSnapshots(snapshot, snapshot, points, DEFAULTS)).toMatchObject({
    idDisagreements: 0, colorFailures: 0, webglReferenceFailures: 2, webgpuReferenceFailures: 2, valid: false,
  })
  const detail = investigateFractional(snapshot, snapshot, points, DEFAULTS)
  expect(detail.points[0]).toMatchObject({ glMask: 2, gpuMask: 2, idDifferences: 0 })
  expect(detail.samples[0]).toMatchObject({ x: 10, y: 9, webgl: null, webgpu: null, ids: { webgl: null, webgpu: null, cpu: 0 } })
})

it('compares production styling, exact pick masks and visual alpha across frozen settings', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const [name, changes] of STYLING_CASES) {
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

it('checks explicit-coordinate quads at the unchanged full-frame gates and recovers the six boundary pixels', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const [name, changes] of [...STYLING_CASES, ['fractional', {}], ['fractional', { ratio: 2 }]] as const) {
      const settings = { ...DEFAULTS, ...changes }; const points = fixture(name)
      const a = await gl.render(points, settings, false, 'explicit'); const b = await gpu.render(points, settings, false, 'explicit')
      const result = compareSnapshots(a, b, points, settings)
      expect(result, `${name} ${JSON.stringify(changes)} ${JSON.stringify(result)}`).toMatchObject({
        idDisagreements: 0,
        webglReferenceFailures: 0,
        webgpuReferenceFailures: 0,
        colorFailures: 0,
        webglInvisiblePicks: 0,
        webgpuInvisiblePicks: 0,
        valid: true,
      })
      if (name === 'fractional' && settings.ratio === 2) {
        for (const [i, [x, y]] of BOUNDARY_PIXELS.entries()) {
          for (const image of [a, b]) {
            expect(pick(image, x, y)).toBe([2, 2, 4, 4, 6, 6][i])
            expect(image.color[(y * image.width + x) * 4 + 3]).toBeGreaterThanOrEqual(128)
          }
        }
      }
    }
    for (let shape = 0; shape < 8; shape++) {
      for (const backend of [gl, gpu]) {
        const image = await backend.render([point(100, 100, shape)], DEFAULTS, false, 'explicit')
        let failures = 0
        for (let i = 0; i < image.width * image.height; i++) {
          if ((image.color[i * 4 + 3] >= 128) !== (pick(image, i % image.width, Math.floor(i / image.width)) !== null)) failures++
        }
        expect(failures, `explicit shape ${shape}: rendered half-alpha must equal picked mask`).toBe(0)
      }
    }
    // Switching away from the candidate must restore the original point path.
    const points = fixture('fractional'); const settings = { ...DEFAULTS, ratio: 2 }
    const before = await gl.render(points, settings)
    await gl.render(points, settings, true, 'explicit')
    const after = await gl.render(points, settings)
    expect(after.color.every((v, i) => v === before.color[i])).toBe(true)
    expect(after.ids.every((v, i) => v === before.ids[i])).toBe(true)
    const hidden = { ...DEFAULTS, opacity: 0 }
    const visibility = compareSnapshots(await gl.render(points, hidden, false, 'explicit'),
      await gpu.render(points, hidden, false, 'explicit'), points, hidden)
    expect(visibility).toMatchObject({
      valid: true,
      webglPickedPixels: 0,
      webgpuPickedPixels: 0,
      webglPaintedPixels: 0,
      webgpuPaintedPixels: 0,
      webglInvisiblePicks: 0,
      webgpuInvisiblePicks: 0,
    })
  } finally { gpu?.destroy(); gl.destroy() }
})

it.each([['shapes', false], ['overlap', false], ['overlap', true], ['edge-cases', false], ['fractional', false]] as const)(
  'checks candidate opacity 0, 0.35 and 1 for %s, reversed %s, while retaining production picks', async (name, reverse) => {
    const gl = await createStylingWebGL(document.createElement('canvas'))
    let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
    try {
      gpu = await createStylingWebGPU(document.createElement('canvas'))
      const points = fixture(name)
      for (const ratio of [1, 2]) {
        let translucent: { gl: Uint8Array; gpu: Uint8Array } | undefined
        for (const opacity of [0, 0.35, 1]) {
          const settings = { ...DEFAULTS, ratio, opacity, reverse }
          const a = await gl.render(points, settings, false, 'explicit'); const b = await gpu.render(points, settings, false, 'explicit')
          const result = compareSnapshots(a, b, points, settings)
          expect(result, `${name} ${ratio} ${opacity} ${JSON.stringify(result)}`).toMatchObject({
            valid: true,
            pickingRules: { webgl: 'visible', webgpu: 'visible' },
            idDisagreements: 0,
            webglReferenceFailures: 0,
            webgpuReferenceFailures: 0,
            colorFailures: 0,
            webglInvisiblePicks: 0,
            webgpuInvisiblePicks: 0,
          })
          if (opacity === 0) {
            for (const image of [a, b]) { expect(image.color.every(v => v === 0)).toBe(true); expect(image.ids.every(v => v === 0)).toBe(true) }
          } else {
            expect(result.webglPickedPixels).toBeGreaterThan(0); expect(result.webgpuPickedPixels).toBeGreaterThan(0)
            if (opacity === 0.35) translucent = { gl: a.ids, gpu: b.ids }
            else {
              expect(a.ids.every((v, i) => v === translucent!.gl[i])).toBe(true)
              expect(b.ids.every((v, i) => v === translucent!.gpu[i])).toBe(true)
            }
          }
        }
        const settings = { ...DEFAULTS, ratio, opacity: 0, reverse }
        const legacy = compareSnapshots(await gl.render(points, settings), await gpu.render(points, settings), points, settings)
        expect(legacy.pickingRules).toEqual({ webgl: 'legacy', webgpu: 'legacy' })
        expect(legacy.webglInvisiblePicks).toBeGreaterThan(0); expect(legacy.webgpuInvisiblePicks).toBeGreaterThan(0)
        expect(legacy.webglInvisiblePicks).toBe(legacy.webglPickedPixels)
        expect(legacy.webgpuInvisiblePicks).toBe(legacy.webgpuPickedPixels)
        expect(legacy.valid).toBe(false)
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
      const plainGl = await gl.render(points, settings); const plainGpu = await gpu.render(points, settings)
      const diagnosticGl = await gl.render(points, settings, true); const diagnosticGpu = await gpu.render(points, settings, true)
      for (const [plain, diagnostic] of [[plainGl, diagnosticGl], [plainGpu, diagnosticGpu]]) {
        expect(diagnostic.color.every((v, i) => v === plain.color[i]), 'probes must not change production color').toBe(true)
        expect(diagnostic.ids.every((v, i) => v === plain.ids[i]), 'probes must not change production IDs').toBe(true)
        const offset = (Math.floor(260.75 * ratio) * diagnostic.width + Math.floor(190.25 * ratio)) * 4
        expect(diagnostic.probe!.geometry[offset + 2]).toBe(Math.fround(13.3 * ratio))
      }
      const comparison = compareSnapshots(diagnosticGl, diagnosticGpu, points, settings)
      const investigation = investigateFractional(diagnosticGl, diagnosticGpu, points, settings)
      expect(investigation.points.reduce((n, p) => n + p.idDifferences, 0)).toBe(comparison.idDisagreements)
      expect(investigation.points.reduce((n, p) => n + p.glMask, 0)).toBe(comparison.webglReferenceFailures)
      expect(investigation.points.reduce((n, p) => n + p.gpuMask, 0)).toBe(comparison.webgpuReferenceFailures)
      expect(investigation.points.reduce((n, p) => n + p.colorFailures, 0)).toBe(comparison.colorFailures)
      const control = compareSnapshots(diagnosticGl.analyticControl!, diagnosticGpu, points, settings)
      expect(control.idDisagreements).toBe(0); expect(control.colorFailures).toBe(0)
      // Sprite-boundary disagreement with the original closed scalar mask is
      // retained even when both GPU renderers agree with one another.
      expect(control.webglReferenceFailures).toBe(control.webgpuReferenceFailures)
      expect(comparison.webglInvisiblePicks).toBe(0)
      expect(comparison.webgpuInvisiblePicks).toBe(0)
      // This is a diagnostic report, not a universal requirement for WebGL to fail.
      // The live UI retains every color/ID failure and rejects cross-backend parity.
    }
  } finally { gpu?.destroy(); gl.destroy() }
})
