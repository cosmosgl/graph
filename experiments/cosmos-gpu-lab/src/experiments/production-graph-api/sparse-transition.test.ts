import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runSparseTransition, type SparseSample } from './sparse-transition'

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

it.each([1, 2] as const)('removes and restores a slot in both packages at %i×', async ratio => {
  const gl = await runSparseTransition('webgl', ratio)
  const gpu = await runSparseTransition('webgpu', ratio)
  const comparisons = gl.samples.map(({ phase, time, pixels, ...webgl }, i) => {
    const { pixels: other, phase: otherPhase, time: otherTime, ...webgpu } = gpu.samples[i]!
    expect([otherPhase, otherTime]).toEqual([phase, time])
    return { phase, time, ...comparePixels(pixels, other), webgl, webgpu }
  })
  await writeArtifact(`package-sparse-transition-${ratio}x`, {
    devices: [gl.deviceInfo, gpu.deviceInfo], ratio, comparisons,
  })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  const removing = gl.samples.filter(sample => sample.phase === 'remove')
  const restoring = gl.samples.filter(sample => sample.phase === 'restore')
  expect(gl.samples.filter(sample => sample.phase !== 'remove' && sample.phase !== 'restore').map(sample => sample.phase))
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
