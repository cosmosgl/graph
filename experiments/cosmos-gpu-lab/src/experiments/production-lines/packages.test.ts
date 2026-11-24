import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { compareLines } from './compare'
import { background, exactLineCases, lineCases, type LineCase } from './fixture'
import { mountLinePreview, type LineSession, type LineSnapshot } from './frame'

function pixel (image: ImageData, ratio: number, x: number, y: number): number[] {
  const i = 4 * (Math.floor(y * ratio) * image.width + Math.floor(x * ratio))
  return [...image.data.slice(i, i + 4)]
}

function checkDrawing (snapshot: LineSnapshot, scene: LineCase, moved: boolean, ratio: number): void {
  const im = snapshot.pixels
  const rgb = (x: number, y: number): number[] => pixel(im, ratio, x, y).slice(0, 3)
  expect.soft(rgb(200, 106)).toEqual(background)
  const marker = scene === 'zoom' ? [118, 15] : [120, 28]
  expect.soft(rgb(marker[0]!, marker[1]!)).toEqual([255, 255, 255])
  if (scene === 'straight' || scene === 'moving' || scene === 'gradient') {
    expect.soft(rgb(180, 48), 'the 0.75 px stroke remains visible').not.toEqual(background)
    expect.soft(rgb(74, 111), 'the diagonal remains visible').not.toEqual(background)
  }
  // Use the settled, straight horizontal link to check that each style actually changed paint.
  if (moved || scene === 'zoom' || scene === 'curved') {
    // A moved dotted link has a gap at the generic center probe. The sixth
    // dot is centered at distance 44 CSS px along its new 120 × 24 direction.
    const [x, y] = scene === 'dotted' && moved ? [59, 36.5] : snapshot.picks[0]!.xy
    expect.soft(rgb(x, y), 'paint follows the projected or moved endpoint').not.toEqual(background)
    if (scene === 'hover') expect.soft(rgb(x, y), 'the moved link reacquires hover').toEqual([244, 217, 108])
    if (moved && scene !== 'curved' && scene !== 'zoom') expect.soft(rgb(60, 28)).toEqual(background)
  } else if (scene === 'dashed' || scene === 'dotted') {
    expect.soft(rgb(scene === 'dashed' ? 27 : 24, 28), 'gap stays unpainted').toEqual(background)
    expect.soft(rgb(20, 28), 'dash or dot remains visible').not.toEqual(background)
  } else if (scene === 'gradient') {
    expect.soft(rgb(22, 28)[0]!).toBeGreaterThan(rgb(22, 28)[2]!)
    expect.soft(rgb(130, 28)[2]!).toBeGreaterThan(rgb(130, 28)[0]!)
  } else if (scene === 'arrows') {
    expect.soft(rgb(71, 30), 'arrow widens the middle of the stroke').not.toEqual(background)
  } else if (scene === 'hover') {
    expect.soft(rgb(46, 28)).toEqual([244, 217, 108])
    expect.soft(rgb(46, 30), 'hover increases the painted width').not.toEqual(background)
  } else {
    expect.soft(rgb(46, 28)).toEqual([103, 186, 224])
    expect.soft(rgb(46, 30), 'the padded pick target leaves the background unpainted').toEqual(background)
  }
}

for (const ratio of [1, 2] as const) {
  it.each(Object.keys(lineCases) as LineCase[])(`compares packaged %s links and click callbacks at ${ratio}×`, async scene => {
    const host = document.createElement('div')
    document.body.append(host)
    const sessions: LineSession[] = []
    try {
      for (const engine of ['webgl', 'webgpu'] as const) sessions.push(await mountLinePreview(host, engine, ratio, scene))
      const devices = sessions.map(session => session.deviceInfo)
      if (import.meta.env.LAB_NATIVE_GPU) {
        expect(devices[0]!.gpuType).not.toBe('cpu'); expect(devices[1]!.fallback).toBe(false)
      } else {
        expect(devices[0]!.renderer).toMatch(/SwiftShader/i); expect(devices[1]!.gpuArchitecture).toBe('swiftshader')
      }
      let initial: LineSnapshot[] = []
      for (const moved of [false, true]) {
        const [gl, gpu] = await Promise.all([sessions[0]!.measure(moved), sessions[1]!.measure(moved)])
        if (!moved) initial = [gl, gpu]
        const result = compareLines(gl, gpu)
        await writeArtifact(`package-lines-${scene}-${ratio}x-${moved ? 'moved' : 'initial'}`, {
          devices, scene, ratio, moved, ...result, picks: { webgl: gl.picks, webgpu: gpu.picks },
        })
        for (const frame of [gl, gpu]) {
          checkDrawing(frame, scene, moved, ratio)
          for (const pick of frame.picks) expect.soft(pick.actual, `${scene} ${pick.label} at ${pick.xy}`).toBe(pick.expected)
        }
        if (exactLineCases.has(scene)) {
          expect.soft(result.differingPixels, 'the full canvas must match for this fixture').toBe(0)
        }
        expect.soft(result.outsideEdgeBand, 'paint farther than one device pixel from the other mask').toBe(0)
        expect.soft(result.interiorColorFailures, 'interior channels differ by more than two levels').toBe(0)
      }
      if (scene === 'moving') {
        for (const [i, session] of sessions.entries()) {
          const restored = await session.measure(false)
          expect(comparePixels(initial[i]!.pixels, restored.pixels).differingPixels, 'restoring the endpoint reproduces every original pixel').toBe(0)
          expect(restored.picks).toEqual(initial[i]!.picks)
        }
      }
    } finally {
      for (const session of sessions) session.destroy()
      host.remove()
    }
  })
}
