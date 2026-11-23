import { expect, it } from 'vitest'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { compareCollision } from './compare'
import { absent, collisionCenter, collisionConfig, collisionInput, collisionViewport, colors, isolated, pinned, sizes } from './fixture'
import { mountCollision } from './frame'

function makeHost (): HTMLDivElement {
  const frame = document.createElement('iframe')
  frame.width = String(collisionViewport.width)
  frame.height = String(collisionViewport.height)
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.body.style.margin = '0'
  const host = doc.createElement('div')
  host.style.cssText = 'position:relative;width:100vw;height:100vh'
  doc.body.append(host)
  return host
}

// The expected image follows from the known camera and opaque discs. Allow one pixel
// around each silhouette for rasterization, but check every core and background pixel.
function checkDrawing (xy: Float32Array, pixels: ImageData): void {
  const { width, height, data } = pixels
  expect([width, height]).toEqual([collisionViewport.width, collisionViewport.height])
  const background = [24, 32, 43]
  const corePixels = Array<number>(absent).fill(0)
  let incorrect = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let expected: readonly number[] | undefined = background
      for (let id = absent - 1; id >= 0; id--) {
        const cx = width / 2 + (xy[id * 2] - collisionCenter)
        const cy = height / 2 - (xy[id * 2 + 1] - collisionCenter)
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        const radius = sizes[id] / 2
        if (distance > radius + 1) continue
        if (distance < radius - 1) { expected = colors[id]; corePixels[id]++ } else expected = undefined
        break
      }
      if (!expected) continue
      const offset = (y * width + x) * 4
      if (data[offset + 3] !== 255 || expected.some((value, channel) => value !== data[offset + channel])) incorrect++
    }
  }
  expect(incorrect, 'incorrect opaque disc interiors or background pixels').toBe(0)
  expect(Math.min(...corePixels), 'each visible color has a substantial checked core').toBeGreaterThan(60)
}

it.for(['contacts', 'hashed'] as const)('compares real Graph collision positions and pixels using the %s path', async (fixture, { annotate }) => {
  const hosts = [makeHost(), makeHost()]
  const sessions: Awaited<ReturnType<typeof mountCollision>>[] = []
  const initial = collisionInput(fixture).xy
  const measurements = []
  try {
    for (const [i, engine] of (['webgl', 'webgpu'] as const).entries()) {
      sessions.push(await mountCollision(hosts[i], engine, fixture))
    }
    for (let tick = 0; tick <= 8; tick++) {
      const [webgl, webgpu] = await Promise.all(sessions.map(session => tick ? session.step() : session.snapshot()))
      expect([webgl.tick, webgpu.tick]).toEqual([tick, tick])
      for (const { positions: xy, pixels } of [webgl, webgpu]) {
        if (tick === 0) expect(Array.from(xy)).toEqual(Array.from(initial))
        else {
          expect(Array.from(xy.slice(pinned * 2, pinned * 2 + 2))).toEqual(Array.from(initial.slice(pinned * 2, pinned * 2 + 2)))
          expect(Array.from(xy.slice(isolated * 2))).toEqual(Array.from(initial.slice(isolated * 2))) // isolated, absent and off-screen grid
          for (let id = pinned + 1; id < isolated; id++) {
            expect(Math.hypot(xy[id * 2] - initial[id * 2], xy[id * 2 + 1] - initial[id * 2 + 1])).toBeGreaterThan(0)
          }
          const distanceFromPin = Math.hypot(xy[2] - xy[0], xy[3] - xy[1])
          expect(distanceFromPin).toBeGreaterThan(Math.hypot(initial[2] - initial[0], initial[3] - initial[1]))
        }
        checkDrawing(xy, pixels)
      }
      const report = compareCollision(webgl, webgpu)
      measurements.push({ tick, ...report })
      expect(report.positionMismatches).toBe(0)
      expect(report.maxPositionDelta).toBe(0)
      expect(report.differingPixels, `different RGBA pixels at tick ${tick}, largest channel difference ${report.maxChannelDelta}/255`).toBe(0)
    }
    await annotate(JSON.stringify(measurements))
  } finally {
    for (const session of sessions) session.destroy()
    for (const host of hosts) host.ownerDocument.defaultView?.frameElement?.remove()
  }
})

it('matches WebGL coverage when circle sprite boundaries land on pixel centers', async () => {
  const samples: number[][] = []
  for (const engine of ['webgl', 'webgpu'] as const) {
    const host = makeHost()
    const doc = host.ownerDocument
    const GRAPH = await loadGraphPackage(engine, doc)
    const graph = new GRAPH(host, { ...collisionConfig, backgroundColor: '#000000', pointDefaultColor: '#ffffff', pointDefaultSize: 20 })
    try {
      await graph.ready
      graph.setPointPositions(new Float32Array([collisionCenter + 0.5, collisionCenter - 0.5]), true)
      graph.render(1, 0)
      graph.pause()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [collisionViewport.width, collisionViewport.height])
      graph.renderOneFrame()
      const capture = doc.createElement('canvas')
      capture.width = collisionViewport.width
      capture.height = collisionViewport.height
      const context = capture.getContext('2d')!
      context.drawImage(host.querySelector('canvas')!, 0, 0)
      const pixels = context.getImageData(0, 0, capture.width, capture.height)
      const x = capture.width / 2
      const y = capture.height / 2
      // Center, left, right, top, bottom in canvas coordinates (y increases down).
      samples.push([[x, y], [x - 10, y], [x + 10, y], [x, y - 10], [x, y + 10]]
        .map(([column, row]) => pixels.data[(row * capture.width + column) * 4]))
    } finally { graph.destroy(); doc.defaultView?.frameElement?.remove() }
  }
  const [webgl, webgpu] = samples
  expect(webgl.map(value => value > 0)).toEqual([true, true, false, false, true])
  expect(webgpu).toEqual(webgl)
})
