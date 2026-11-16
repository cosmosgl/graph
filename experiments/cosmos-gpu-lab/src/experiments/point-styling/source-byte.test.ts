import { expect, it } from 'vitest'
import { pick } from './backend'
import { DEFAULTS, fixture, point } from './data'
import { compareColors, compareSnapshotsAsync } from './reference'
import { sourceAlphaByte } from './source-alpha'
import { contributionPasses, inspectForeground } from './tiny-alpha'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

it('keeps original colors and visible source-byte picks at every alpha-byte boundary', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const f = new Float32Array(1); const bits = new Uint32Array(f.buffer)
    const alpha = [0, 1, ...Array.from({ length: 255 }, (_, byte) => {
      f[0] = (byte + 0.5) / 255; const center = bits[0]
      return [-1, 0, 1].map(offset => { bits[0] = center + offset; return f[0] })
    }).flat()]
    const points = alpha.map((a, i) => point(8.5 + (i % 32) * 16, 6.5 + Math.floor(i / 32) * 13, 0,
      { size: 4, color: [0.62, 0.71, 0.84, a] }))
    for (const backend of [gl, gpu]) {
      const before = await backend.render(points, DEFAULTS, false, 'explicit', false)
      const image = await backend.render(points, DEFAULTS, false, 'eligibility', false)
      expect(compareColors(before, image), `${backend.info}: original color preservation`)
        .toEqual({ changedPixels: 0, maxChannelError: 0, budgetFailures: 0 })
      points.forEach((p, i) => {
        const x = Math.floor(p.x); const y = Math.floor(p.y); const expectedByte = sourceAlphaByte(alpha[i])
        const eligible = expectedByte > 0; const actualId = pick(image, x, y)
        const offset = (y * image.width + x) * 4
        f[0] = alpha[i]
        const context = JSON.stringify({
          backend: backend.info,
          sample: i,
          alpha: alpha[i],
          alphaBits: `0x${bits[0].toString(16).padStart(8, '0')}`,
          pixel: [x, y],
          expectedByte,
          expectedId: eligible ? i : null,
          actualId,
          originalRgba: Array.from(before.color.subarray(offset, offset + 4)),
          candidateRgba: Array.from(image.color.subarray(offset, offset + 4)),
        })
        expect(actualId, context).toBe(eligible ? i : null)
        if (eligible) expect(image.color[offset + 3], `own paint: ${context}`).toBeGreaterThan(0)
      })
    }
  } finally { gpu?.destroy(); gl.destroy() }
})

it('preserves styling colors byte-for-byte at unchanged full-frame CPU and GPU gates', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const name of ['shapes', 'overlap', 'edge-cases', 'fractional'] as const) {
      for (const ratio of [1, 2]) {
        for (const opacity of [0, 0.35, 1]) {
          const points = fixture(name); const settings = { ...DEFAULTS, ratio, opacity }
          const pair = {
            webgl: await gl.render(points, settings, false, 'eligibility', false),
            webgpu: await gpu.render(points, settings, false, 'eligibility', false),
          }
          expect(await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings), `${name} ratio ${ratio} opacity ${opacity}`)
            .toMatchObject({ valid: true })
          for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
            const baseline = await backend.render(points, settings, false, 'explicit', false)
            expect(compareColors(baseline, pair[lane]).changedPixels).toBe(0)
          }
        }
      }
    }
    const points = fixture('tiny-overlap')
    const pair = {
      webgl: await gl.render(points, DEFAULTS, false, 'eligibility', false),
      webgpu: await gpu.render(points, DEFAULTS, false, 'eligibility', false),
    }
    expect(contributionPasses(await inspectForeground({ webgl: gl, webgpu: gpu }, pair, points, DEFAULTS, 'eligibility'))).toBe(true)
    expect(pick(pair.webgl, 256, 160)).toBe(0); expect(pick(pair.webgpu, 256, 160)).toBe(0)
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)

it('preserves faint-stack accumulation and restores all retained controls after eligibility draws', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const points = fixture('alpha-stack')
    const pair = {
      webgl: await gl.render(points, DEFAULTS, false, 'eligibility', false),
      webgpu: await gpu.render(points, DEFAULTS, false, 'eligibility', false),
    }
    expect(await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, DEFAULTS)).toMatchObject({ valid: true })
    for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
      for (const variant of ['production', 'explicit', 'quantized'] as const) {
        const before = await backend.render(points, DEFAULTS, false, variant, false)
        await backend.render(points, DEFAULTS, false, 'eligibility', false)
        const after = await backend.render(points, DEFAULTS, false, variant, false)
        expect(after.color).toEqual(before.color); expect(after.ids).toEqual(before.ids)
        if (variant === 'explicit') expect(compareColors(before, pair[lane]).changedPixels).toBe(0)
        if (variant === 'production') expect(compareColors(before, pair[lane]).budgetFailures).toBe(0)
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
