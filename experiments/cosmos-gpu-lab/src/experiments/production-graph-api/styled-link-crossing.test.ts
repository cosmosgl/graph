import { expect, it } from 'vitest'
import { comparePixels, type PixelComparison } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runStyledLinkCrossing, styledLinkProbes, type StyledLinkSample } from './styled-link-crossing'

const phases = ['dash', 'gap'] as const
const orders = ['solid-dashed', 'dashed-solid', 'solid-only', 'dashed-only'] as const
const red = [255, 0, 0]
const green = [0, 255, 0]
const black = [0, 0, 0]

function sampleAt (samples: StyledLinkSample[], phase: StyledLinkSample['phase'], order: StyledLinkSample['order']): StyledLinkSample {
  const sample = samples.find(s => s.phase === phase && s.order === order)
  if (!sample) throw new Error(`Missing ${phase} phase for ${order}`)
  return sample
}

function measureReversal (samples: StyledLinkSample[], phase: StyledLinkSample['phase'], ratio: number): {
  fullFrame: PixelComparison; differencesOutsideOverlap: number; differencesOutsideCrossing: number;
} {
  const dashedOnTop = sampleAt(samples, phase, 'solid-dashed').pixels
  const solidOnTop = sampleAt(samples, phase, 'dashed-solid').pixels
  const solid = sampleAt(samples, phase, 'solid-only').pixels
  const dashed = sampleAt(samples, phase, 'dashed-only').pixels
  let differencesOutsideOverlap = 0
  let differencesOutsideCrossing = 0
  const fullFrame = comparePixels(dashedOnTop, solidOnTop, undefined, index => {
    const offset = 4 * index
    if (!solid.data[offset + 1] || !dashed.data[offset]) differencesOutsideOverlap++
    const x = index % solid.width
    const y = Math.floor(index / solid.width)
    if (x < 124 * ratio || x >= 132 * ratio || y < 76 * ratio || y >= 84 * ratio) differencesOutsideCrossing++
  })
  return { fullFrame, differencesOutsideOverlap, differencesOutsideCrossing }
}

function expectedSites (phase: StyledLinkSample['phase'], order: StyledLinkSample['order']): StyledLinkSample['sites'] {
  const hasSolid = order !== 'dashed-only'
  const hasDashed = order !== 'solid-only'
  const dashInk = phase === 'dash' && hasDashed
  const solidPick = order === 'dashed-solid' ? 'Link 1' : 'Link 0'
  const dashedPick = order === 'solid-dashed' ? 'Link 1' : 'Link 0'
  const dashedPaintsOnTop = dashInk && order !== 'dashed-solid'
  return {
    crossing: { rgb: dashedPaintsOnTop ? red : hasSolid ? green : black, pick: hasSolid && hasDashed ? 'Link 1' : 'Link 0' },
    horizontal: { rgb: dashInk ? red : black, pick: hasDashed ? dashedPick : 'Background' },
    opposite: { rgb: hasDashed && phase === 'gap' ? red : black, pick: hasDashed ? dashedPick : 'Background' },
    vertical: { rgb: hasSolid ? green : black, pick: hasSolid ? solidPick : 'Background' },
    background: { rgb: black, pick: 'Background' },
  }
}

it.each([1, 2] as const)('draws and picks crossing dashed and solid links in either record order at %i×', async ratio => {
  const gl = await runStyledLinkCrossing('webgl', ratio)
  const gpu = await runStyledLinkCrossing('webgpu', ratio)
  const devices = [gl.deviceInfo, gpu.deviceInfo]
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  const comparisons = phases.flatMap(phase => orders.map(order => {
    const a = sampleAt(gl.samples, phase, order)
    const b = sampleAt(gpu.samples, phase, order)
    return { phase, order, webgl: a.sites, webgpu: b.sites, fullFrame: comparePixels(a.pixels, b.pixels) }
  }))
  const reversals = phases.map(phase => ({ phase, webgl: measureReversal(gl.samples, phase, ratio), webgpu: measureReversal(gpu.samples, phase, ratio) }))
  await writeArtifact(`package-styled-link-crossing-${ratio}x`, {
    revision: import.meta.env.LAB_SOURCE_REVISION, devices, ratio, probes: styledLinkProbes, comparisons, reversals,
  })

  for (const row of comparisons) {
    const expected = expectedSites(row.phase, row.order)
    const label = `${row.phase} phase, ${row.order}`
    expect.soft(row.webgl, `WebGL ${label}`).toEqual(expected)
    expect.soft(row.webgpu, `WebGPU ${label}`).toEqual(expected)
    expect.soft(row.fullFrame.totalPixels, label).toBe(256 * 160 * ratio ** 2)
    expect.soft(row.fullFrame.differingPixels, label).toBe(0)
  }
  for (const row of reversals) {
    for (const reversal of [row.webgl, row.webgpu]) {
      expect.soft(reversal.differencesOutsideOverlap, row.phase).toBe(0)
      expect.soft(reversal.differencesOutsideCrossing, row.phase).toBe(0)
      expect.soft(reversal.fullFrame.differingPixels, row.phase).toBe(row.phase === 'dash' ? (8 * ratio) ** 2 : 0)
    }
  }
})
