import { expect, it, vi } from 'vitest'
import { waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { graphRgba } from '../../runtime/palette'
import { createResidentChain, createResidentGraph } from './resident-graph'

it.each([1, 2])('composites cached highlights in original draw order at DPR %s', async pixelRatio => {
  const scope = resourceScope()
  const { input, graph } = createResidentChain(6)
  input.points.set([
    -9, 0, 0, 0, // Partly covered by the later pin.
    -7.5, 0, 1, 0,
    9, 2, 0, 0,
    9, 2, 0, 1, // Absent point above point 2 in draw order.
    0, 6, 0, 0, // Fully covered by point 5.
    0, 6, 0, 0,
  ])
  const makeCanvas = (): HTMLCanvasElement => {
    const canvas = document.createElement('canvas')
    canvas.width = 47 * pixelRatio
    canvas.height = 35 * pixelRatio
    document.body.append(canvas)
    scope.own({ destroy: () => canvas.remove() })
    return canvas
  }
  const expectedCanvas = makeCanvas(); const actualCanvas = makeCanvas()
  const readCanvas = document.createElement('canvas')
  readCanvas.width = actualCanvas.width
  readCanvas.height = actualCanvas.height
  const context = readCanvas.getContext('2d', { willReadFrequently: true })!
  const capture = (source: HTMLCanvasElement): Uint8ClampedArray => {
    context.drawImage(source, 0, 0)
    return context.getImageData(0, 0, source.width, source.height).data
  }
  const includes = (pixels: Uint8ClampedArray, color: keyof typeof graphRgba): boolean => {
    const bytes = graphRgba[color].map(channel => Math.round(channel * 255))
    return pixels.some((_, i) => i % 4 === 0 && bytes.every((byte, channel) => pixels[i + channel] === byte))
  }
  try {
    const expected = scope.own(await createResidentGraph(expectedCanvas, input, graph, 'per-point', { pixelRatio }))
    const actual = scope.own(await createResidentGraph(actualCanvas, input, graph, 'per-point', { pixelRatio, cachedHighlight: true }))
    const camera = { x: 0, y: 0, zoom: 1 }
    expected.setCamera(camera); actual.setCamera(camera)
    actual.redraw()
    await waitForGpu(actual.device)
    const passes = vi.spyOn(actual.device, 'beginRenderPass')
    try {
      const compare = (id: number | null, renderPasses = 1): Uint8ClampedArray => {
        passes.mockClear()
        expected.select(id); expected.redraw()
        const reference = capture(expectedCanvas)
        actual.select(id); actual.redrawHighlight()
        const pixels = capture(actualCanvas)
        expect(passes).toHaveBeenCalledTimes(renderPasses)
        const mismatch = pixels.findIndex((byte, index) => byte !== reference[index])
        const offset = mismatch - mismatch % 4
        expect(mismatch, JSON.stringify({ id, actual: pixels.slice(offset, offset + 4), expected: reference.slice(offset, offset + 4) })).toBe(-1)
        return pixels
      }
      const starting = compare(null)
      for (const color of ['background', 'point', 'pinned', 'link'] as const) expect(includes(starting, color)).toBe(true)
      const behindPin = compare(0)
      expect(includes(behindPin, 'coral')).toBe(true)
      expect(includes(behindPin, 'pinned')).toBe(true)
      expect(compare(4)).toEqual(starting)
      expect(includes(compare(5), 'coral')).toBe(true)
      expect(includes(compare(1), 'coral')).toBe(true)
      expect(compare(null)).toEqual(starting)

      const panned = { ...camera, x: 3.25, y: -1.5 }
      expected.setCamera(panned); actual.setCamera(panned)
      expect(compare(2, 2)).not.toEqual(starting)
      const stationary = compare(2)
      expect(includes(stationary, 'coral')).toBe(true)

      expected.frame(0, 0.25, false); actual.frame(0, 0.25, false)
      expect(compare(2, 2)).not.toEqual(stationary)
      compare(null)
    } finally { passes.mockRestore() }
  } finally { scope.destroy() }
}, 30000)
