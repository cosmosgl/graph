import { expect, it } from 'vitest'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { pick } from './backend'
import { effectScenario } from './effects-fixtures'
import { compareSnapshotsAsync, referencePick } from './reference'
import { auditPolygons, exactDiamondSide } from './polygon-audit'
import { effectsCpuColors } from './effects-reference'

it('proves diamond edge ties independently while retaining the existing scalar classification', () => {
  for (const scale of [0.25, 1, 2]) {
    for (const [x, y] of [[1, 18], [6, 12], [11, 6], [16, 0]]) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          expect(exactDiamondSide(sx * x * scale, sy * y * scale, 40 * scale)).toBe(0)
        }
      }
    }
  }
  expect(exactDiamondSide(1 - 2 ** -20, 18, 40)).toBe(-1)
  expect(exactDiamondSide(1 + 2 ** -20, 18, 40)).toBe(1)
  const { points, settings } = effectScenario('shapes', 0)
  expect(referencePick(points, settings, 225.5, 82.5, 'source-alpha')).toBeNull()
  expect(referencePick(points, settings, 220.5, 88.5, 'source-alpha')).toBe(3)
  expect(() => exactDiamondSide(Infinity, 0, 40)).toThrow()
})

it('isolates the remaining CPU diamond ties with pixel-space probes and retains production and normalized controls', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const { points, settings } = effectScenario('shapes', 0)
    const config = { ...settings, polygonArithmetic: 'pixels' as const }
    const original = {
      webgl: await gl.render(points, settings, false, 'production', false),
      webgpu: await gpu.render(points, settings, false, 'production', false),
    }
    const normalized = {
      webgl: await gl.render(points, settings, true, 'eligibility', false),
      webgpu: await gpu.render(points, settings, true, 'eligibility', false),
    }
    const a = await gl.render(points, config, true, 'eligibility', false)
    const b = await gpu.render(points, config, true, 'eligibility', false)
    const comparison = await compareSnapshotsAsync(a, b, points, settings)
    const audit = auditPolygons(a, b, points, settings)
    expect(comparison.idDisagreements).toBe(0); expect(comparison.colorFailures).toBe(0)
    expect(comparison.webglInvisiblePicks + comparison.webgpuInvisiblePicks).toBe(0)
    // Keep the original gate: identical GPU images do not accept the eight CPU disagreements.
    expect(comparison.valid).toBe(false)
    expect([comparison.webglReferenceFailures, comparison.webgpuReferenceFailures]).toEqual([8, 8])
    expect(audit.samples).toHaveLength(8)
    audit.samples.forEach(s => {
      expect(s.shape).toBe(3); expect(s.exactDiamondSide).toBe(0); expect(s.expected).toBeNull()
      expect(s.cpuDistance).toBeGreaterThan(0); expect(s.webgl).toBe(s.point); expect(s.webgpu).toBe(s.point)
      expect([s.webglDistance, s.webgpuDistance, s.webglCoverage, s.webgpuCoverage]).toEqual([0, 0, 0.5, 0.5])
    })
    for (const [x, y, id] of [[148, 89, 2], [184, 89, 2], [406, 118, 6], [148, 209, 10], [184, 209, 10], [406, 238, 14]]) {
      expect(pick(a, x, y)).toBe(id); expect(pick(b, x, y)).toBe(id)
    }
    for (const [backend, snapshot, native, production] of [[gl, a, normalized.webgl, original.webgl],
      [gpu, b, normalized.webgpu, original.webgpu]] as const) {
      expect(effectsCpuColors(snapshot, points, config).budgetFailures).toBe(0)
      const plain = await backend.render(points, config, false, 'eligibility', false)
      expect(plain.color).toEqual(snapshot.color); expect(plain.ids).toEqual(snapshot.ids)
      const restored = await backend.render(points, settings, false, 'eligibility', false)
      expect(restored.color).toEqual(native.color); expect(restored.ids).toEqual(native.ids)
      const control = await backend.render(points, config, false, 'production', false)
      expect(control.polygonArithmetic).toBe('normalized')
      expect(control.color).toEqual(production.color); expect(control.ids).toEqual(production.ids)
      const retina = effectScenario('shapes', 1, { ratio: 2 })
      const before = await backend.render(retina.points, retina.settings, false, 'eligibility', false)
      await backend.render(retina.points, { ...retina.settings, polygonArithmetic: 'pixels' }, false, 'eligibility', false)
      const after = await backend.render(retina.points, retina.settings, false, 'eligibility', false)
      expect(after.color).toEqual(before.color); expect(after.ids).toEqual(before.ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
