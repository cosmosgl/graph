import { expect, it } from 'vitest'
import { comparePixels, type PixelComparison } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runSparseTransition, type SparseSample, type SparseScenario } from './sparse-transition'

function expectedSelections (phase: SparseSample['phase'], time: number, siteCount: 3 | 4 | 5 = 3): SparseSample['selections'] {
  // The default cubic easing gives the live center on each restoration leg,
  // including its first frame when the point has no paint.
  const t = time / 1000
  const progress = t < 0.5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3
  let x = 48
  if (phase === 'restore') x += 32 * progress
  if (phase === 'restore-original') x = 64 - 16 * progress
  if (phase === 'restore-to-80') x = 56 + 24 * progress
  const absent = phase === 'remove' || phase === 'remove-again' || phase === 'remove-on-return' || phase === 'remove-at-68' || phase === 'snap-remove'
  const local = (region: Exclude<SparseSample['selections'][number]['region'], 'all'>, center: number): SparseSample['selections'][number] => ({
    region,
    // Both 4 px regions reach the 12 px radius along their shared horizontal centerline.
    rectangle: !absent && Math.abs(center - x) <= 14 ? [1] : [],
    lasso: !absent && Math.abs(center - x) <= 14 ? [1] : [],
  })
  const all = absent ? [0, 2] : [0, 1, 2]
  return [
    local('old', 48),
    ...(siteCount >= 4 ? [local('returnMidpoint', 56)] : []),
    local('midpoint', 64),
    ...(siteCount === 5 ? [local('removalCenter', 68)] : []),
    local('destination', 80),
    { region: 'all', rectangle: all, lasso: all },
  ]
}

type Measurements = Omit<SparseSample, 'phase' | 'time' | 'pixels'>
type Comparison = Pick<SparseSample, 'phase' | 'time'> & PixelComparison & { webgl: Measurements; webgpu: Measurements }

async function settledFrameHash (samples: SparseSample[], phase: 'restore' | 'restore-to-80'): Promise<string> {
  const frame = samples.find(sample => sample.phase === phase && sample.time === 1000)!
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', frame.pixels.data))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function compareMidpointFrames (samples: SparseSample[], removal: 'remove-again' | 'remove-on-return' | 'remove-at-68'): PixelComparison {
  const beforeRemoval = samples[samples.findIndex(row => row.phase === removal) - 1]!
  const removing = samples.find(row => row.phase === removal && row.time === 500)!
  return comparePixels(beforeRemoval.pixels, removing.pixels)
}

async function compareSparseTransition (ratio: 1 | 2, scenario: SparseScenario): Promise<{
  samples: SparseSample[];
  comparisons: Comparison[];
  referenceRenderer: string;
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
  const repeatedMidpoint = scenario === 'remove-again' || scenario === 'remove-on-return' || scenario === 'remove-at-68'
    ? { webgl: compareMidpointFrames(gl.samples, scenario), webgpu: compareMidpointFrames(gpu.samples, scenario) }
    : undefined
  const restoredOriginal = scenario === 'restore-original'
    ? {
      webgl: comparePixels(gl.samples[0]!.pixels, gl.samples.at(-1)!.pixels),
      webgpu: comparePixels(gpu.samples[0]!.pixels, gpu.samples.at(-1)!.pixels),
    }
    : undefined
  // Record the same x=80 canvas in the full-fade control and the repeatedly interrupted replay.
  const settledPhase = scenario === 'complete' ? 'restore' : scenario === 'restore-to-80' ? 'restore-to-80' : undefined
  const settledAt80Sha256 = settledPhase
    ? { webgl: await settledFrameHash(gl.samples, settledPhase), webgpu: await settledFrameHash(gpu.samples, settledPhase) }
    : undefined
  await writeArtifact(`package-sparse-${suffix}-${ratio}x`, {
    devices: [gl.deviceInfo, gpu.deviceInfo], ratio, comparisons, repeatedMidpoint, restoredOriginal, settledAt80Sha256,
  })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  return { samples: gl.samples, comparisons, referenceRenderer: gl.deviceInfo.renderer, repeatedMidpoint, restoredOriginal }
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

it.each([1, 2] as const)('removes the slot halfway through its return to the original position at %i×', async ratio => {
  const { comparisons, repeatedMidpoint } = await compareSparseTransition(ratio, 'remove-on-return')
  const returning = comparisons.filter(row => row.phase === 'restore-original')
  const fading = comparisons.filter(row => row.phase === 'remove-on-return')
  expect(returning.map(row => row.time)).toEqual([0, 16, 250, 314, 315, 358, 359, 500])
  expect(fading.map(row => row.time)).toEqual([0, 16, 250, 500, 750, 1000])
  expect(comparisons.indexOf(fading[0]!)).toBe(comparisons.indexOf(returning.at(-1)!) + 1)
  const before = returning.at(-1)!.webgl
  const siteColors = (frame: Measurements): (number[] | undefined)[] => [
    frame.sites?.old.rgb, frame.sites?.returnMidpoint?.rgb, frame.sites?.midpoint?.rgb, frame.sites?.destination.rgb,
  ]
  expect(before.pointBounds?.map(value => value / ratio)).toEqual([50, 90, 62, 102])
  expect(before.linkRgb).toEqual([0, 128, 0])
  expect(siteColors(before)).toEqual([[0, 0, 0], [64, 64, 0], [0, 128, 0], [0, 128, 0]])
  expect(siteColors(fading[0]!.webgl)).toEqual([[255, 0, 0], [255, 0, 0], [255, 0, 0], [0, 255, 0]])
  expect([before.sites?.old.pick, before.sites?.returnMidpoint?.pick, before.sites?.midpoint?.pick, before.sites?.destination.pick])
    .toEqual(['Point 1', 'Point 1', 'Point 1', 'Link 0'])
  expect(fading.filter(row => row.time % 500 === 0).map(row => row.webgl.pointBounds?.map(value => value / ratio) ?? null))
    .toEqual([[44, 84, 68, 108], [50, 90, 62, 102], null])
  expect(fading.map(row => row.webgl.linkRgb[1])).toEqual([255, 255, 239, 128, 16, 0])
  expect(repeatedMidpoint?.webgl.differingPixels).toBe(0)
  expect(repeatedMidpoint?.webgpu.differingPixels).toBe(0)
  for (const row of comparisons) {
    const label = `${row.phase} ${row.time} ms`
    const frame = row.webgl
    expect.soft(frame.selections, label).toEqual(expectedSelections(row.phase, row.time, 4))
    expect.soft(frame.survivors, label).toEqual([320, 240, 256, 296])
    expect.soft([frame.picks.anchor, frame.picks.control], label).toEqual(['Point 0', 'Point 2'])
    const absent = row.phase === 'remove' || row.phase === 'remove-again' || row.phase === 'remove-on-return'
    expect.soft(frame.sites?.returnMidpoint?.pick, label).toBe(absent ? 'Background' : 'Point 1')
    if (row.phase === 'remove-on-return') {
      expect.soft([frame.sites?.old.pick, frame.sites?.midpoint?.pick, frame.sites?.destination.pick, frame.picks.link], label)
        .toEqual(['Background', 'Background', 'Background', 'Background'])
    }
    expect.soft(row.webgpu, label).toEqual(frame)
    expect.soft(row.differingPixels, label).toBe(0)
  }
})

it.each([1, 2] as const)('restores point 1 at x=80 halfway through its third removal at %i×', async ratio => {
  const { comparisons, referenceRenderer } = await compareSparseTransition(ratio, 'restore-to-80')
  const restoring = comparisons.filter(row => row.phase === 'restore-to-80')
  expect(restoring.map(row => row.time)).toEqual([
    0, 1, 2, 16, 250, 275, 276, 374, 375, 376, 396, 397, 470, 471, 500, 513, 514, 529, 530, 682, 683, 684, 724, 725, 750, 1000,
  ])
  const before = comparisons[comparisons.indexOf(restoring[0]!) - 1]!
  expect(before).toMatchObject({ phase: 'remove-on-return', time: 500 })
  const sites = ['old', 'returnMidpoint', 'midpoint', 'destination'] as const
  const black = [0, 0, 0]
  const paintFrames = [before, ...restoring.filter(row => [0, 1, 2, 16, 500, 1000].includes(row.time))]
  expect(paintFrames.map(({ webgl }) => webgl.pointBounds?.map(value => value / ratio) ?? null)).toEqual([
    [50, 90, 62, 102], null, null, null, null, [62, 90, 74, 102], [68, 84, 92, 108],
  ])
  expect(paintFrames.map(({ webgl }) => webgl.linkRgb[1])).toEqual([128, 0, 0, 0, 0, 128, 255])
  const unpainted = [black, black, black, black]
  expect(paintFrames.map(({ webgl }) => sites.map(site => webgl.sites?.[site]?.rgb))).toEqual([
    [black, [64, 64, 0], [0, 128, 0], [0, 128, 0]],
    unpainted, unpainted, unpainted, unpainted,
    [black, black, [64, 0, 0], [0, 128, 0]],
    [black, black, black, [255, 0, 0]],
  ])
  const background = 'Background'
  const point = 'Point 1'
  // At the half-resolution pick-window edge, both packages switch a millisecond
  // later at x=80 and a millisecond earlier at x=56 on SwiftShader than on Metal.
  const swiftShader = /swiftshader/i.test(referenceRenderer)
  const destinationHit = swiftShader ? 376 : 375
  const midpointMiss = swiftShader ? 683 : 684
  for (const row of comparisons) {
    const label = `${row.phase} ${row.time} ms`
    const frame = row.webgl
    expect.soft(frame.selections, label).toEqual(expectedSelections(row.phase, row.time, 4))
    expect.soft(frame.survivors, label).toEqual([320, 240, 256, 296])
    expect.soft([frame.picks.anchor, frame.picks.control], label).toEqual(['Point 0', 'Point 2'])
    const clicks = sites.map(site => frame.sites?.[site]?.pick)
    if (row.phase === 'remove-on-return') {
      expect.soft(clicks, label).toEqual([background, background, background, background])
    }
    if (row.phase === 'restore-to-80') {
      // At x=80 the link becomes pickable while it is still too faint to paint.
      const destinationPick = row.time < 2 ? background : row.time < destinationHit ? 'Link 0' : point
      expect.soft(clicks, label).toEqual([
        row.time < 514 ? point : background, row.time < midpointMiss ? point : background, point, destinationPick,
      ])
    }
    expect.soft(row.webgpu, label).toEqual(frame)
    expect.soft(row.differingPixels, label).toBe(0)
  }
})

it.each([1, 2] as const)('removes point 1 at x=68 halfway through its return to x=80 at %i×', async ratio => {
  const { comparisons, repeatedMidpoint } = await compareSparseTransition(ratio, 'remove-at-68')
  const fading = comparisons.filter(row => row.phase === 'remove-at-68')
  expect(fading.map(row => row.time)).toEqual([0, 16, 250, 500, 750, 1000])
  const before = comparisons[comparisons.indexOf(fading[0]!) - 1]!
  expect(before).toMatchObject({ phase: 'restore-to-80', time: 500 })
  const sites = ['old', 'returnMidpoint', 'midpoint', 'removalCenter', 'destination'] as const
  expect(sites.map(site => before.webgl.sites?.[site]?.pick)).toEqual(Array(5).fill('Point 1'))

  const halfBounds = [62, 90, 74, 102]
  const fullBounds = [56, 84, 80, 108]
  const boundsAt250 = ratio === 1 ? [57, 85, 79, 107] : [56.5, 85, 79, 107.5]
  const boundsAt750 = ratio === 1 ? [67, 95, 69, 97] : [67.5, 95.5, 68.5, 96.5]
  expect([before, ...fading].map(({ webgl }) => webgl.pointBounds?.map(value => value / ratio) ?? null)).toEqual([
    halfBounds, fullBounds, fullBounds, boundsAt250, halfBounds, boundsAt750, null,
  ])
  expect(fading.map(({ webgl }) => webgl.linkRgb[1])).toEqual([255, 255, 239, 128, 16, 0])
  const black = [0, 0, 0]
  const red = [255, 0, 0]
  const halfFade = [black, black, [64, 0, 0], [64, 64, 0], [0, 128, 0]]
  const paintFrames = [before, ...fading.filter(row => row.time % 500 === 0)]
  expect(paintFrames.map(({ webgl }) => sites.map(site => webgl.sites?.[site]?.rgb))).toEqual([
    halfFade, [black, red, red, red, [0, 255, 0]], halfFade, sites.map(() => black),
  ])
  // Only the pre-removal frame is interactive, even though the two halfway canvases are identical.
  expect(repeatedMidpoint?.webgl.differingPixels).toBe(0)
  expect(repeatedMidpoint?.webgpu.differingPixels).toBe(0)
  for (const row of comparisons) {
    const label = `${row.phase} ${row.time} ms`
    const frame = row.webgl
    expect.soft(frame.selections, label).toEqual(expectedSelections(row.phase, row.time, 5))
    expect.soft(frame.survivors, label).toEqual([320, 240, 256, 296])
    expect.soft([frame.picks.anchor, frame.picks.control], label).toEqual(['Point 0', 'Point 2'])
    if (row.phase === 'remove-at-68') {
      expect.soft(sites.map(site => frame.sites?.[site]?.pick), label).toEqual(Array(5).fill('Background'))
      expect.soft(frame.picks.link, label).toBe('Background')
    }
    expect.soft(row.webgpu, label).toEqual(frame)
    expect.soft(row.differingPixels, label).toBe(0)
  }
})
