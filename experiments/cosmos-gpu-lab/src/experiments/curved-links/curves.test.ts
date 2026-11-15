import { expect, it } from 'vitest'
import { pick } from '../../gpu/rgba-readback'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'
import { DEFAULTS, fixture, type Settings } from './data'
import { nodes, mesh, reference, compare } from './reference'
import { productionGeometry } from './geometry'
it('independently reconstructs production sampling and its finite-difference triangle strip', () => {
  for (const segments of [1, 3, 19, 32]) {
    const settings = { ...DEFAULTS, segments }; const data = productionGeometry(settings)
    expect(Array.from(data.filter((_, i) => i % 4 === 0))).toEqual(nodes(segments))
    const source = fixture('bows'); const scene = { ...source, links: source.links.slice(0, 1) }
    const triangles = mesh(scene, settings, false, 'visible')
    expect(triangles).toHaveLength(segments * 2); expect(triangles.every(t => t.area < 0)).toBe(true)
    expect(nodes(segments)[0]).toBe(0); expect(nodes(segments).at(-1)).toBe(1)
  }
  const source = fixture('bows'); const scene = { ...source, links: source.links.slice(0, 1) }
  const ref = reference(scene, DEFAULTS)
  expect(ref.ids.visible[80 * ref.width + 130]).toBe(0)
  expect(ref.ids.visible[120 * ref.width + 130]).toBe(-1)
  expect(() => productionGeometry({ ...DEFAULTS, segments: 0 })).toThrow()
  expect(() => productionGeometry({ ...DEFAULTS, weight: 0 })).toThrow()
})
it('renders the production bow, retains original colors and restores modes through public luma APIs', async () => {
  const gl = await createCurvesWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    gpu = await createCurvesWebGPU(document.createElement('canvas')); const scene = fixture('bows')
    const snapshots = []
    for (const backend of [gl, gpu]) {
      const original = await backend.render(scene, DEFAULTS, 'production')
      const visible = await backend.render(scene, DEFAULTS, 'visible')
      expect(visible.color).toEqual(original.color); expect(pick(visible, 130, 80)).toBe(0); expect(pick(visible, 130, 120)).toBeNull()
      expect(pick(visible, 370, 80)).toBe(1); snapshots.push(visible)
      const inverse = await backend.render(scene, { ...DEFAULTS, controlDistance: -0.5 }, 'visible', false)
      expect(pick(inverse, 130, 160)).toBe(0); expect(pick(inverse, 130, 80)).toBeNull()
      const settings: Settings = { ...DEFAULTS, segments: 3, weight: 1.5, ratio: 2, blend: false, indexOffset: 65535 }
      await backend.render(scene, settings, 'visible', false)
      const restored = await backend.render(scene, DEFAULTS, 'production', false)
      expect(restored.color).toEqual(original.color); expect(restored.ids).toEqual(original.ids)
    }
    const result = await compare(snapshots[0], snapshots[1], reference(scene, DEFAULTS))
    // Strict whole-frame acceptance is reported, never inferred from these safe interior probes.
    expect(result.colors.budgetFailures, JSON.stringify(result)).toBe(0)
    for (const blend of [true, false]) {
      const settings = { ...DEFAULTS, blend, opacity: 0 }
      const a = await gl.render(scene, settings, 'visible', false); const b = await gpu.render(scene, settings, 'visible', false)
      expect((await compare(a, b, reference(scene, settings))).passed).toBe(true)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
it('keeps an invisible curved foreground out of picking without altering original blending', async () => {
  const gl = await createCurvesWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    gpu = await createCurvesWebGPU(document.createElement('canvas')); const scene = fixture('overlap')
    for (const backend of [gl, gpu]) {
      const control = await backend.render(scene, DEFAULTS, 'production', false)
      const candidate = await backend.render(scene, DEFAULTS, 'visible', false)
      expect(pick(control, 256, 122)).toBe(3); expect(pick(candidate, 256, 122)).toBe(0)
      expect(candidate.color).toEqual(control.color)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
it('rejects invisible picks from an isolated folded ribbon even when both backends agree', async () => {
  const { assess } = await import('./study')
  const gl = await createCurvesWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    gpu = await createCurvesWebGPU(document.createElement('canvas'))
    const input = fixture('limits'); const scene = { ...input, links: [input.links[3]] }
    const settings = { ...DEFAULTS, zoom: 0.5, scaleOnZoom: false, opacity: 0.35 }
    const { evidence } = await assess({ webgl: gl, webgpu: gpu }, scene, settings)
    expect(evidence.passed).toBe(false)
    for (const lane of ['webgl', 'webgpu'] as const) {
      expect(evidence.candidate.invisible[lane]).toBeGreaterThan(0)
      expect(evidence.sourceVisibility.candidate[lane]).toBe(evidence.candidate.invisible[lane])
      expect(evidence.sourceVisibility.candidate.unknown[lane]).toBe(0)
      expect(evidence.preservation[lane].changedPixels).toBe(0)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
