import { expect, it } from 'vitest'
import { DECODE_SPACES, DECODE_WIDTH, DECODE_HEIGHT, expectedDecoded } from './decode-fixtures'
import { decodeImages, auditDecoded } from './image-decoding'
import { runDecodingSweep, DECODING_PROFILES } from './decoding-study'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { DEFAULTS, fixture } from './data'

it('decodes generated ICC PNGs with exact orientation/alpha and independently predicted opaque sRGB colors', async () => {
  const decoded = await decodeImages('production')
  try {
    const audit = auditDecoded(decoded, decoded)
    expect(decoded.images.every(image => image.width === DECODE_WIDTH && image.height === DECODE_HEIGHT)).toBe(true)
    expect(decoded.colorSpaces).toEqual(DECODE_SPACES.map(() => 'srgb'))
    expect(audit.every(row => row.valid)).toBe(true)
    expect(expectedDecoded('linear-srgb').bytes[0]).toBeGreaterThan(expectedDecoded('srgb').bytes[0])
    expect(decoded.images[2].bytes[0]).toBeGreaterThan(decoded.images[1].bytes[0])
  } finally { decoded.close() }
})

it('normalizes premultiplied bitmaps through sRGB ImageData and reports a deliberately flipped decoder', async () => {
  const control = await decodeImages('production'); const normal = await decodeImages('normalized-premultiplied'); const flipped = await decodeImages('flipped')
  try {
    expect(auditDecoded(normal, control).every(row => row.valid)).toBe(true)
    expect(auditDecoded(flipped, control).every(row => !row.valid && row.alphaDifferences > 0)).toBe(true)
  } finally { control.close(); normal.close(); flipped.close() }
})

it('audits luma uploads and rejected decode controls without changing the production draw', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const before = {
      gl: await gl.render(fixture('shapes'), DEFAULTS, false, 'production', false),
      gpu: await gpu.render(fixture('shapes'), DEFAULTS, false, 'production', false),
    }
    const rows = await runDecodingSweep({ webgl: gl, webgpu: gpu }, () => {}, () => false,
      { profiles: [DECODING_PROFILES[0]], filters: ['nearest'] })
    expect(rows).toHaveLength(7)
    expect(rows.find(r => r.policy === 'production')!.passed).toBe(true)
    expect(rows.find(r => r.policy === 'normalized-premultiplied')!.passed).toBe(true)
    expect(rows.find(r => r.policy === 'flipped')!.passed).toBe(false)
    expect(rows.every(r => JSON.stringify(r.production) === JSON.stringify(rows[0].production))).toBe(true)
    const after = {
      gl: await gl.render(fixture('shapes'), DEFAULTS, false, 'production', false),
      gpu: await gpu.render(fixture('shapes'), DEFAULTS, false, 'production', false),
    }
    expect(after.gl.color).toEqual(before.gl.color); expect(after.gl.ids).toEqual(before.gl.ids)
    expect(after.gpu.color).toEqual(before.gpu.color); expect(after.gpu.ids).toEqual(before.gpu.ids)
  } finally { gpu?.destroy(); gl.destroy() }
}, 180000)
