import { expect, it } from 'vitest'
import { resourceScope } from '../../gpu/resource-scope'
import { createResidentChain, createResidentGraph } from './resident-graph'

it.each([1, 2])('skips covered circles while preserving selected point color and order at DPR %s', async pixelRatio => {
  const count = 257
  const { input, graph } = createResidentChain(count)
  const lastPoints = 224
  // Several later points cover each of the packed circles. Keep some circles
  // and links along the outside so clipped coverage is also observable.
  for (let i = 0; i < lastPoints; i++) {
    const x = i % 8 < 7 ? 1 + (i % 4) * 0.5 : -5 - i % 16
    input.points.set([x, 1 + (i % 7) * 0.4, 0, 0], i * 4)
  }
  for (let i = lastPoints; i < count; i++) {
    const cell = i - lastPoints
    input.points.set([cell % 6, Math.floor(cell / 6), 0, 0], i * 4)
  }
  input.points[2] = 1
  input.points[(count - 1) * 4 + 2] = 1
  input.points[7] = 1
  input.points[8] = -48.75
  const resources = resourceScope()
  const makeCanvas = (): HTMLCanvasElement => {
    const canvas = document.createElement('canvas')
    canvas.width = 128 * pixelRatio; canvas.height = 64 * pixelRatio
    document.body.append(canvas)
    resources.own({ destroy: () => canvas.remove() })
    return canvas
  }
  const referenceCanvas = makeCanvas(); const filteredCanvas = makeCanvas()
  const capture = document.createElement('canvas')
  capture.width = referenceCanvas.width; capture.height = referenceCanvas.height
  const context = capture.getContext('2d', { willReadFrequently: true })!
  const pixels = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
    context.drawImage(canvas, 0, 0)
    return context.getImageData(0, 0, canvas.width, canvas.height).data
  }
  try {
    const reference = resources.own(await createResidentGraph(referenceCanvas, input, graph, 'per-point', { pixelRatio, picking: true }))
    const filtered = resources.own(await createResidentGraph(filteredCanvas, input, graph, 'per-point', { pixelRatio, picking: true, pointCulling: true }))
    const camera = { x: 16.25, y: 6.75, zoom: 1 }
    reference.setCamera(camera); filtered.setCamera(camera)
    for (const selected of [null, 30, count - 3, count - 1]) {
      reference.select(selected); reference.redraw()
      const expected = pixels(referenceCanvas)
      filtered.select(selected); filtered.redraw()
      const actual = pixels(filteredCanvas)
      expect(actual.some((channel, index) => channel !== expected[index])).toBe(false)
    }
    expect(await filtered.readDrawnPointCount()).toBeLessThan(count - 1)
    const picked = await reference.pick(50 * pixelRatio, 37 * pixelRatio)
    expect(picked).not.toBeNull()
    expect(await filtered.pick(50 * pixelRatio, 37 * pixelRatio)).toBe(picked)
  } finally { resources.destroy() }
}, 30000)
