import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { compareLines } from './compare'
import { findMotionFlashes, inspectMotionPaint, motionCase, motionPixelIndices, phaseSteps, type MotionStyle } from './motion'
import { background, exactLineCases, lineCases, type LineCase, type Probe } from './fixture'
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

async function frameDigest (image: ImageData): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', image.data))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

it.each([1, 2] as const)('repaints and picks a width-only update in both packages at %i×', async ratio => {
  const host = document.createElement('div')
  document.body.append(host)
  const sessions: LineSession[] = []
  try {
    for (const engine of ['webgl', 'webgpu'] as const) sessions.push(await mountLinePreview(host, engine, ratio, 'straight'))
    for (const width of [2, 12, 2]) {
      const probes: Probe[] = [
        { label: 'Widened stroke', xy: [46, 33], expected: width === 12 ? 'Link 0' : 'Background' },
        { label: 'Foreground point', xy: [120, 28], expected: 'Point 8' },
      ]
      const [gl, gpu] = await Promise.all(sessions.map(session => session.measureWidths(Float32Array.of(width, 3.25, 1.5, 0.75), probes)))
      expect(comparePixels(gl.pixels, gpu.pixels).differingPixels).toBe(0)
      for (const snapshot of [gl, gpu]) {
        expect(pixel(snapshot.pixels, ratio, 46, 32).slice(0, 3)).toEqual(width === 12 ? [103, 186, 224] : background)
        expect(snapshot.picks.map(pick => pick.actual)).toEqual(probes.map(probe => probe.expected))
      }
    }
  } finally {
    for (const session of sessions) session.destroy()
    host.remove()
  }
})

for (const ratio of [1, 2] as const) {
  it.each<MotionStyle>(['dashed', 'solid'])(`replays %s cap motion forward and backward at ${ratio}×`, async style => {
    const sessions: LineSession[] = []
    const host = document.createElement('div')
    document.body.append(host)
    try {
      for (const engine of ['webgl', 'webgpu'] as const) sessions.push(await mountLinePreview(host, engine, ratio, motionCase, style))
      const devices = sessions.map(s => s.deviceInfo)
      if (import.meta.env.LAB_NATIVE_GPU) {
        expect(devices[0]!.gpuType).not.toBe('cpu'); expect(devices[1]!.fallback).toBe(false)
      } else {
        expect(devices[0]!.renderer).toMatch(/SwiftShader/i); expect(devices[1]!.gpuArchitecture).toBe('swiftshader')
      }
      const ascending = Array.from({ length: 2 * phaseSteps + 1 }, (_, i) => i - phaseSteps)
      const indices = motionPixelIndices(ratio)
      const trace: [Uint8Array[], Uint8Array[]] = [[], []]
      const hashes = new Map<number, string[]>()
      const frames = []
      let worst = { phase: 0, maxChannelDelta: -1, differingPixels: 0 }
      for (const reverse of [false, true]) {
        for (const phase of reverse ? [...ascending].reverse() : ascending) {
          const pick = phase === 0 || Math.abs(phase) === phaseSteps
          const [gl, gpu] = await Promise.all([sessions[0]!.measure(phase, pick), sessions[1]!.measure(phase, pick)])
          const comparison = compareLines(gl, gpu)
          const paint = [gl, gpu].map(frame => inspectMotionPaint(frame.pixels, phase, ratio, style))
          const digest = await Promise.all([gl, gpu].map(frame => frameDigest(frame.pixels)))
          if (!reverse) {
            hashes.set(phase, digest)
            for (const [i, frame] of [gl, gpu].entries()) trace[i]!.push(Uint8Array.from(indices, p => frame.pixels.data[4 * p + 2]!))
          }
          const reproduced = !reverse || digest.every((hash, i) => hashes.get(phase)?.[i] === hash)
          const picks = pick ? { webgl: gl.picks, webgpu: gpu.picks } : undefined
          frames.push({ phase, direction: reverse ? 'reverse' : 'forward', ...comparison, paint, picks, reproduced })
          if (comparison.maxChannelDelta > worst.maxChannelDelta ||
            (comparison.maxChannelDelta === worst.maxChannelDelta && comparison.differingPixels > worst.differingPixels)) {
            worst = { phase, maxChannelDelta: comparison.maxChannelDelta, differingPixels: comparison.differingPixels }
          }
        }
      }
      const flashes = findMotionFlashes(trace[0], trace[1], indices, ratio)
      await writeArtifact(`package-lines-cap-motion-${style}-${ratio}x`, {
        devices, browser: navigator.userAgent, ratio, style, phaseSteps, frames, worst, flashes,
      })
      for (const row of frames) {
        const label = `${style} ${ratio}× ${row.direction} phase ${row.phase}/${phaseSteps}`
        expect.soft(row.outsideEdgeBand, `${label} outline`).toBe(0)
        expect.soft(row.interiorColorFailures, `${label} interior`).toBe(0)
        expect.soft(row.pickFailures, `${label} click IDs`).toBe(0)
        expect.soft(row.paint, `${label} dash centers and gaps`).toEqual([{ missing: 0, paintedGaps: 0 }, { missing: 0, paintedGaps: 0 }])
        expect.soft(row.reproduced, `${label} reproduced byte for byte on each engine`).toBe(true)
      }
      expect(flashes.pixels, `WebGPU flashed while WebGL held steady: ${JSON.stringify(flashes)}`).toBe(0)
    } finally {
      for (const session of sessions) session.destroy()
      host.remove()
    }
  }, 180000)
}
