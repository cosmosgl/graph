import { expect, it } from 'vitest'
import { comparePixels, type PixelComparison } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runSparseTransition, type SparseSample, type SparseScenario } from './sparse-transition'

function expectedSelections (phase: SparseSample['phase'], time: number): SparseSample['selections'] {
  // The default cubic easing gives the live center on each restoration leg,
  // including its first frame when the point has no paint.
  const t = time / 1000
  const progress = t < 0.5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3
  let x = 48
  if (phase === 'restore') x += 32 * progress
  if (phase === 'restore-original') x = 64 - 16 * progress
  const absent = phase === 'remove' || phase === 'remove-again' || phase === 'snap-remove'
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

function compareMidpointFrames (samples: SparseSample[]): PixelComparison {
  const restoring = samples.find(row => row.phase === 'restore' && row.time === 500)!
  const removing = samples.find(row => row.phase === 'remove-again' && row.time === 500)!
  return comparePixels(restoring.pixels, removing.pixels)
}

async function compareSparseTransition (ratio: 1 | 2, scenario: SparseScenario): Promise<{
  samples: SparseSample[];
  comparisons: Comparison[];
  repeatedMidpoint?: { webgl: PixelComparison; webgpu: PixelComparison };
  restoredOriginal?: { webgl: PixelComparison; webgpu: PixelComparison };
}> {
  const gl = await runSparseTransition('webgl', ratio, scenario)
  const gpu = await runSparseTransition('webgpu', ratio, scenario)
  const comparisons = gl.samples.map(({ phase, time, pixels, ...webgl }, i) => {
    const { pixels: other, phase: otherPhase, time: otherTime, ...webgpu } = gpu.samples[i]!
    expect([otherPhase, otherTime]).toEqual([phase, time])
    return { phase, time, ...comparePixels(pixels, other), webgl, webgpu }
  })
  const suffix = scenario === 'complete' ? 'transition' : scenario === 'interrupted' ? 'interruption' : scenario
  const repeatedMidpoint = scenario === 'remove-again' ? { webgl: compareMidpointFrames(gl.samples), webgpu: compareMidpointFrames(gpu.samples) } : undefined
  const restoredOriginal = scenario === 'restore-original'
    ? {
      webgl: comparePixels(gl.samples[0]!.pixels, gl.samples.at(-1)!.pixels),
      webgpu: comparePixels(gpu.samples[0]!.pixels, gpu.samples.at(-1)!.pixels),
    }
    : undefined
  await writeArtifact(`package-sparse-${suffix}-${ratio}x`, {
    devices: [gl.deviceInfo, gpu.deviceInfo], ratio, comparisons, repeatedMidpoint, restoredOriginal,
  })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  return { samples: gl.samples, comparisons, repeatedMidpoint, restoredOriginal }
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

it.each([1, 2] as const)('removes the slot again halfway through its restoration at %i×', async ratio => {
  const { comparisons, repeatedMidpoint } = await compareSparseTransition(ratio, 'remove-again')
  expect(comparisons.map(row => [row.phase, row.time])).toEqual([
    ['initial', 0], ['remove', 0], ['remove', 500], ['restore', 0], ['restore', 16], ['restore', 250], ['restore', 500],
    ['remove-again', 0], ['remove-again', 16], ['remove-again', 250], ['remove-again', 500], ['remove-again', 750], ['remove-again', 1000],
  ])
  const point = 'Point 1'
  const link = 'Link 0'
  const background = 'Background'
  const initialFrames = comparisons.filter(row => row.phase !== 'remove-again')
  expect(initialFrames.map(({ webgl: { sites } }) => [sites?.old.pick, sites?.midpoint?.pick, sites?.destination.pick])).toEqual([
    [point, point, link], [background, background, background], [background, background, background],
    [point, point, background], [point, point, link], [point, point, link], [point, point, point],
  ])
  const midpointBounds = [58, 90, 70, 102]
  const fullBounds = [52, 84, 76, 108]
  const secondFade = comparisons.filter(row => row.phase === 'remove-again')
  const before = initialFrames.at(-1)!.webgl
  expect(before.pointBounds?.map(value => value / ratio)).toEqual(midpointBounds)
  expect(before.linkRgb).toEqual([0, 128, 0])
  expect(secondFade.filter(row => row.time % 500 === 0).map(({ webgl }) => webgl.pointBounds?.map(value => value / ratio) ?? null))
    .toEqual([fullBounds, midpointBounds, null])
  expect(secondFade.map(({ webgl }) => webgl.linkRgb[1])).toEqual([255, 255, 239, 128, 16, 0])
  // The two half-painted frames look identical even though only the first is interactive.
  expect(repeatedMidpoint?.webgl.differingPixels).toBe(0)
  expect(repeatedMidpoint?.webgpu.differingPixels).toBe(0)
  for (const row of comparisons) {
    for (const engine of ['webgl', 'webgpu'] as const) {
      const frame = row[engine]
      const label = `${engine} ${row.phase} ${row.time} ms`
      expect.soft(frame.selections, label).toEqual(expectedSelections(row.phase, row.time))
      expect.soft(frame.survivors, label).toEqual([320, 240, 256, 296])
      expect.soft([frame.picks.anchor, frame.picks.control], label).toEqual(['Point 0', 'Point 2'])
      if (row.phase === 'remove-again') {
        expect.soft([frame.sites?.old.pick, frame.sites?.midpoint?.pick, frame.sites?.destination.pick, frame.picks.link], label)
          .toEqual(['Background', 'Background', 'Background', 'Background'])
      }
    }
    expect.soft(row.webgpu, `${row.phase} ${row.time} ms`).toEqual(row.webgl)
    expect.soft(row.differingPixels, `${row.phase} ${row.time} ms`).toBe(0)
  }
})

it.each([1, 2] as const)('restores the original position halfway through the second removal at %i×', async ratio => {
  const { comparisons, restoredOriginal } = await compareSparseTransition(ratio, 'restore-original')
  expect(comparisons.map(row => [row.phase, row.time])).toEqual([
    ['initial', 0], ['remove', 0], ['remove', 500], ['restore', 0], ['restore', 16], ['restore', 250], ['restore', 500],
    ['remove-again', 0], ['remove-again', 16], ['remove-again', 250], ['remove-again', 500],
    ['restore-original', 0], ['restore-original', 16], ['restore-original', 250], ['restore-original', 314], ['restore-original', 315],
    ['restore-original', 358], ['restore-original', 359], ['restore-original', 500], ['restore-original', 685], ['restore-original', 686],
    ['restore-original', 750], ['restore-original', 1000],
  ])
  expect(restoredOriginal?.webgl.differingPixels).toBe(0)
  expect(restoredOriginal?.webgpu.differingPixels).toBe(0)
  const beforeEdit = comparisons.find(row => row.phase === 'remove-again' && row.time === 500)!.webgl
  expect(beforeEdit.pointBounds?.map(value => value / ratio)).toEqual([58, 90, 70, 102])
  expect(beforeEdit.linkRgb).toEqual([0, 128, 0])
  expect([beforeEdit.sites?.old.pick, beforeEdit.sites?.midpoint?.pick, beforeEdit.sites?.destination.pick])
    .toEqual(['Background', 'Background', 'Background'])
  const returning = comparisons.filter(row => row.phase === 'restore-original')
  const paintKeyframes = returning.filter(row => row.time % 500 === 0 || row.time === 16)
  expect(paintKeyframes.map(row => row.webgl.pointBounds?.map(value => value / ratio) ?? null))
    .toEqual([null, null, [50, 90, 62, 102], [36, 84, 60, 108]])
  expect(returning.map(row => row.webgl.linkRgb[1])).toEqual([0, 0, 16, 32, 32, 47, 47, 128, 223, 223, 239, 255])
  for (const row of comparisons) {
    const label = `${row.phase} ${row.time} ms`
    for (const engine of ['webgl', 'webgpu'] as const) {
      const frame = row[engine]
      const at = `${engine} ${label}`
      expect.soft(frame.selections, at).toEqual(expectedSelections(row.phase, row.time))
      expect.soft(frame.survivors, at).toEqual([320, 240, 256, 296])
      expect.soft([frame.picks.anchor, frame.picks.control], at).toEqual(['Point 0', 'Point 2'])
      if (row.phase === 'restore-original') {
        // At x=80 the link is exposed once point 1 leaves the pointer's search window.
        expect.soft([frame.sites?.old.pick, frame.sites?.midpoint?.pick, frame.sites?.destination.pick], at)
          .toEqual(['Point 1', 'Point 1', row.time < 359 ? 'Point 1' : 'Link 0'])
      }
    }
    expect.soft(row.webgpu, label).toEqual(row.webgl)
    expect.soft(row.differingPixels, label).toBe(0)
  }
  expect(comparisons.at(-1)!.webgl).toEqual(comparisons[0]!.webgl)
})
