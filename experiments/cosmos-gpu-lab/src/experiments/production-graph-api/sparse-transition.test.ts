import { expect, it } from 'vitest'
import { comparePixels, type PixelComparison } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runSparseTransition, type SparseSample, type SparseScenario } from './sparse-transition'

function expectedSelections (phase: SparseSample['phase'], time: number): SparseSample['selections'] {
  // The destination lies 32 CSS px from the frozen position. The default cubic
  // easing gives the restored center, even on the first frame with no paint.
  const t = time / 1000
  const progress = t < 0.5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3
  const x = phase === 'restore' ? 48 + 32 * progress : 48
  const absent = phase === 'remove' || phase === 'snap-remove'
  const local = (region: 'old' | 'midpoint' | 'destination', center: number): SparseSample['selections'][number] => ({
    region,
    // The 4 px rectangle also reaches half the full requested 24 px diameter.
    rectangle: !absent && Math.abs(center - x) <= 14 ? [1] : [],
    // Along the diamond's middle row, its left edge is inclusive.
    lasso: !absent && x >= center - 2 && x < center + 2 ? [1] : [],
  })
  const all = absent ? [0, 2] : [0, 1, 2]
  return [local('old', 48), local('midpoint', 64), local('destination', 80), { region: 'all', rectangle: all, lasso: all }]
}

type Measurements = Omit<SparseSample, 'phase' | 'time' | 'pixels'>
type Comparison = Pick<SparseSample, 'phase' | 'time'> & PixelComparison & { webgl: Measurements; webgpu: Measurements }

async function compareSparseTransition (ratio: 1 | 2, scenario: SparseScenario): Promise<{ samples: SparseSample[]; comparisons: Comparison[] }> {
  const gl = await runSparseTransition('webgl', ratio, scenario)
  const gpu = await runSparseTransition('webgpu', ratio, scenario)
  const comparisons = gl.samples.map(({ phase, time, pixels, ...webgl }, i) => {
    const { pixels: other, phase: otherPhase, time: otherTime, ...webgpu } = gpu.samples[i]!
    expect([otherPhase, otherTime]).toEqual([phase, time])
    return { phase, time, ...comparePixels(pixels, other), webgl, webgpu }
  })
  const name = scenario === 'interrupted' ? 'package-sparse-interruption' : 'package-sparse-transition'
  await writeArtifact(`${name}-${ratio}x`, {
    devices: [gl.deviceInfo, gpu.deviceInfo], ratio, comparisons,
  })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  return { samples: gl.samples, comparisons }
}

it.each([1, 2] as const)('removes and restores a slot in both packages at %i×', async ratio => {
  const { samples, comparisons } = await compareSparseTransition(ratio, 'complete')
  const removing = samples.filter(sample => sample.phase === 'remove')
  const restoring = samples.filter(sample => sample.phase === 'restore')
  expect(samples.filter(sample => sample.phase !== 'remove' && sample.phase !== 'restore').map(sample => sample.phase))
    .toEqual(['initial', 'snap-remove', 'snap-restore'])
  expect(removing.map(sample => sample.time)).toEqual([0, 500, 1000])
  expect(restoring.map(sample => sample.time)).toEqual([0, 500, 521, 522, 749, 750, 751, 1000])
  const restorationKeyframes = restoring.filter(sample => sample.time % 500 === 0)
  const cssBounds = (values: number[]): number[] => values.map(n => n * ratio)
  expect(removing.map(sample => sample.pointBounds)).toEqual([cssBounds([36, 84, 60, 108]), cssBounds([42, 90, 54, 102]), null])
  expect(restorationKeyframes.map(sample => sample.pointBounds)).toEqual([null, cssBounds([58, 90, 70, 102]), cssBounds([68, 84, 92, 108])])
  expect(removing.map(sample => sample.linkRgb[1])).toEqual([255, 128, 0])
  expect(restorationKeyframes.map(sample => sample.linkRgb[1])).toEqual([0, 128, 255])
  expect(restorationKeyframes.map(sample => [sample.picks.point, sample.picks.link])).toEqual([
    ['Background', 'Background'], ['Point 1', 'Link 0'], ['Point 1', 'Link 0'],
  ])
  for (const row of comparisons) {
    const label = `${row.phase} ${row.time} ms`
    for (const engine of ['webgl', 'webgpu'] as const) {
      expect.soft(row[engine].selections, `${engine} ${label}`).toEqual(expectedSelections(row.phase, row.time))
    }
    expect.soft(row.webgl.picks.anchor, label).toBe('Point 0')
    expect.soft(row.webgl.picks.control, label).toBe('Point 2')
    expect.soft(row.webgl.survivors, label).toEqual([320, 240, 256, 296])
    if (row.phase === 'remove' || row.phase === 'snap-remove') {
      expect.soft([row.webgl.picks.point, row.webgl.picks.link], label).toEqual(['Background', 'Background'])
    }
    expect.soft(row.webgpu, label).toEqual(row.webgl)
    expect.soft(row.differingPixels, label).toBe(0)
  }
})

it.each([1, 2] as const)('restores the slot halfway through its removal fade at %i×', async ratio => {
  const { comparisons } = await compareSparseTransition(ratio, 'interrupted')
  const point = 'Point 1'
  const link = 'Link 0'
  const background = 'Background'
  // The destination lies on the incident link. The wide click window reaches
  // both endpoint probes when the point is halfway between them.
  expect(comparisons.map(({ phase, time, webgl }) => [phase, time, webgl.sites?.old.pick, webgl.sites?.destination.pick])).toEqual([
    ['initial', 0, point, link],
    ['remove', 0, background, background],
    ['remove', 500, background, background],
    ['restore', 0, point, background],
    ['restore', 16, point, link],
    ['restore', 250, point, link],
    ['restore', 500, point, point],
    ['restore', 521, point, point],
    ['restore', 522, point, point],
    ['restore', 749, background, point],
    ['restore', 750, background, point],
    ['restore', 751, background, point],
    ['restore', 1000, background, point],
  ])
  const keyframes = comparisons.filter(row => row.time % 500 === 0 || row.time === 16)
  const green = [0, 255, 0]
  const halfGreen = [0, 128, 0]
  const black = [0, 0, 0]
  expect(keyframes.map(({ webgl }) => [webgl.pointBounds?.map(value => value / ratio) ?? null, webgl.linkRgb])).toEqual([
    [[36, 84, 60, 108], green], // Initial
    [[36, 84, 60, 108], green], // The first removal frame still paints the full point.
    [[42, 90, 54, 102], halfGreen], // Just before restoring the slot.
    [null, black], // The first restoration frame shares the preceding frame's clock.
    [null, black], // At 16 ms even the link rounds to zero intensity.
    [[58, 90, 70, 102], halfGreen],
    [[68, 84, 92, 108], green],
  ])
  expect(comparisons.find(row => row.phase === 'restore' && row.time === 500)?.webgl.midpointPicks).toEqual([background, point, point, point, link])
  for (const row of comparisons) {
    const label = `${row.phase} ${row.time} ms`
    for (const engine of ['webgl', 'webgpu'] as const) {
      expect.soft(row[engine].selections, `${engine} ${label}`).toEqual(expectedSelections(row.phase, row.time))
    }
    expect.soft(row.webgl.survivors, label).toEqual([320, 240, 256, 296])
    expect.soft([row.webgl.picks.anchor, row.webgl.picks.control], label).toEqual(['Point 0', 'Point 2'])
    expect.soft(row.webgpu, label).toEqual(row.webgl)
    expect.soft(row.differingPixels, label).toBe(0)
  }
})
