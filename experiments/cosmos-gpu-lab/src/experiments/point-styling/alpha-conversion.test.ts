import { expect, it } from 'vitest'
import { conversionRows, inspectAlphaConversion } from './alpha-conversion'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { DEFAULTS, point } from './data'
import { compareColors } from './reference'
import { pick } from './backend'

declare module 'vitest' {
  interface TaskMeta { alphaConversion?: unknown }
}

for (const type of ['webgl', 'webgpu'] as const) {
  it(`${type}: isolates source alpha, byte conversion and blending without changing the visibility gate`, async ({ task }) => {
    const result = await inspectAlphaConversion(type)
    const rows = conversionRows(result)
    expect(rows).toHaveLength(767)
    for (const row of rows) {
      expect(row.shaderAlpha, JSON.stringify(row)).toBe(row.alpha)
      expect(Math.round(row.shaderByte), JSON.stringify(row)).toBe(row.policyByte)
      expect(row.blended, JSON.stringify(row)).toBe(row.unblended)
    }
    // This is an observation, not a replacement gate. The existing source-byte
    // tests continue to reject a picked sample whose actual paint is zero.
    const differences = rows.filter(row => row.unblended !== row.policyByte)
    const summary = {
      backend: result.backend,
      samples: rows.length,
      policyDifferences: differences.length,
      invisibleEligible: differences.filter(row => row.policyByte > 0 && row.unblended === 0),
      examples: differences.slice(0, 8),
    }
    task.meta.alphaConversion = summary
    // eslint-disable-next-line no-console
    console.info('Alpha conversion', JSON.stringify(summary))
  })
  it(`${type}: connects byte conversion to the unchanged point visibility and color controls`, async ({ task }) => {
    const conversion = await inspectAlphaConversion(type)
    const backend = await (type === 'webgl' ? createStylingWebGL : createStylingWebGPU)(document.createElement('canvas'))
    try {
      const points = Array.from(conversion.samples, (alpha, i) => point(8.5 + (i % 32) * 16, 6.5 + Math.floor(i / 32) * 13, 0,
        { size: 4, color: [0.62, 0.71, 0.84, alpha] }))
      const original = await backend.render(points, DEFAULTS, false, 'explicit', false)
      const candidate = await backend.render(points, DEFAULTS, false, 'eligibility', false)
      const quantized = await backend.render(points, DEFAULTS, false, 'quantized', false)
      expect(compareColors(original, candidate).changedPixels).toBe(0)
      for (const [i, p] of points.entries()) {
        const offset = (Math.floor(p.y) * candidate.width + Math.floor(p.x)) * 4
        expect(candidate.color[offset + 3], `sample ${i}: point versus isolated conversion`).toBe(conversion.blended[i * 4 + 3])
      }
      const x = 56; const y = 6; const offset = (y * candidate.width + x) * 4
      const summary = {
        backend: backend.info,
        sample: 3,
        alpha: conversion.samples[3],
        predictedByte: conversionRows(conversion)[3].policyByte,
        picked: pick(candidate, x, y),
        original: Array.from(original.color.subarray(offset, offset + 4)),
        candidate: Array.from(candidate.color.subarray(offset, offset + 4)),
        quantized: Array.from(quantized.color.subarray(offset, offset + 4)),
        quantizedChangedPixels: compareColors(original, quantized).changedPixels,
      }
      task.meta.alphaConversion = summary
      // eslint-disable-next-line no-console
      console.info('Point conversion', JSON.stringify(summary))
    } finally { backend.destroy() }
  })
}
