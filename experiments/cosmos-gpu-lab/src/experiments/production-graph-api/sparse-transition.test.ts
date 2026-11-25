import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runSparseTransition } from './sparse-transition'

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
  const cssBounds = (values: number[]): number[] => values.map(n => n * ratio)
  expect(removing.map(sample => sample.pointBounds)).toEqual([cssBounds([36, 84, 60, 108]), cssBounds([42, 90, 54, 102]), null])
  expect(restoring.map(sample => sample.pointBounds)).toEqual([null, cssBounds([58, 90, 70, 102]), cssBounds([68, 84, 92, 108])])
  expect(removing.map(sample => sample.linkRgb[1])).toEqual([255, 128, 0])
  expect(restoring.map(sample => sample.linkRgb[1])).toEqual([0, 128, 255])
  expect(restoring.map(sample => [sample.picks.point, sample.picks.link])).toEqual([
    ['Background', 'Background'], ['Point 1', 'Link 0'], ['Point 1', 'Link 0'],
  ])
  for (const row of comparisons) {
    const label = `${row.phase} ${row.time} ms`
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
