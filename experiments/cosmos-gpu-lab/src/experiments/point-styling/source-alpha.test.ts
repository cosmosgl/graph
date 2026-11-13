import { expect, it } from 'vitest'
import { pick } from './backend'
import { DEFAULTS, fixture, point } from './data'
import { compareSnapshots, referencePick } from './reference'
import { sourceAlphaByte } from './source-alpha'
import { contributionPasses, inspectForeground } from './tiny-alpha'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

function neighbors (value: number): number[] {
  const data = new Float32Array([value]); const bits = new Uint32Array(data.buffer); const center = bits[0]
  return [-1, 0, 1].map(offset => { bits[0] = center + offset; return data[0] })
}

it('declares source-byte eligibility separately from positive-alpha and legacy controls', () => {
  const center = [50.5, 60.5] as const
  const tiny = [point(...center, 0, { size: 1 / 64 })]
  expect(referencePick(tiny, DEFAULTS, ...center, 'visible')).toBe(0)
  expect(referencePick(tiny, DEFAULTS, ...center, 'source-alpha')).toBeNull()
  const overlap = fixture('tiny-overlap')
  expect(referencePick(overlap, DEFAULTS, 256, 160, 'legacy')).toBe(1)
  expect(referencePick(overlap, DEFAULTS, 256, 160, 'visible')).toBe(1)
  expect(referencePick(overlap, DEFAULTS, 256, 160, 'source-alpha')).toBe(0)
  expect(referencePick(overlap, { ...DEFAULTS, reverse: true }, 256, 160, 'source-alpha')).toBe(0)
  expect(neighbors(0.5 / 255).map(sourceAlphaByte)).toEqual([0, 1, 1])
  expect([0, 0.5, 1].map(sourceAlphaByte)).toEqual([0, 128, 255])
})

it('quantizes all 255 byte boundaries and adjacent f32 values identically in WebGL and WebGPU', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const alpha = [0, 1, ...Array.from({ length: 255 }, (_, byte) => neighbors((byte + 0.5) / 255)).flat()]
    const points = alpha.map((a, i) => point(8.5 + (i % 32) * 16, 6.5 + Math.floor(i / 32) * 13, 0,
      { size: 4, color: [0.62, 0.71, 0.84, a] }))
    for (const backend of [gl, gpu]) {
      const image = await backend.render(points, DEFAULTS, false, 'quantized', false)
      points.forEach((p, i) => {
        const x = Math.floor(p.x); const y = Math.floor(p.y); const expected = sourceAlphaByte(alpha[i])
        expect(image.color[(y * image.width + x) * 4 + 3], `alpha sample ${i}: ${alpha[i]}`).toBe(expected)
        expect(pick(image, x, y), `ID sample ${i}: ${alpha[i]}`).toBe(expected ? i : null)
      })
    }
  } finally { gpu?.destroy(); gl.destroy() }
})

it('preserves bounded styling/color gates and the rejected controls after quantized draws', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const name of ['shapes', 'overlap', 'edge-cases', 'fractional'] as const) {
      for (const ratio of [1, 2]) {
        for (const opacity of [0, 0.35, 1]) {
          const points = fixture(name); const settings = { ...DEFAULTS, ratio, opacity }
          const pair = {
            webgl: await gl.render(points, settings, false, 'quantized', false),
            webgpu: await gpu.render(points, settings, false, 'quantized', false),
          }
          const comparison = compareSnapshots(pair.webgl, pair.webgpu, points, settings)
          expect(comparison, `${name} ratio ${ratio} opacity ${opacity}`).toMatchObject({ valid: true })
          for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
            const baseline = await backend.render(points, settings, false, 'explicit', false)
            expect(compareSnapshots(baseline, pair[lane], points, settings).colorFailures).toBe(0)
          }
        }
      }
    }
    const points = fixture('tiny-overlap')
    const pair = {
      webgl: await gl.render(points, DEFAULTS, false, 'quantized', false),
      webgpu: await gpu.render(points, DEFAULTS, false, 'quantized', false),
    }
    const audit = await inspectForeground({ webgl: gl, webgpu: gpu }, pair, points, DEFAULTS, 'quantized')
    expect(contributionPasses(audit)).toBe(true)
    expect(audit.webgl.checked).toBe(0); expect(audit.webgpu.checked).toBe(0)
    for (const backend of [gl, gpu]) {
      const legacy = await backend.render(points, DEFAULTS, false, 'production', false)
      const visible = await backend.render(points, DEFAULTS, false, 'explicit', false)
      expect(pick(legacy, 256, 160)).toBe(1); expect(pick(visible, 256, 160)).toBe(1)
      expect(legacy.pickingRule).toBe('legacy'); expect(visible.pickingRule).toBe('visible')
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
