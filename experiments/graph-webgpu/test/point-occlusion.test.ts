import { RenderKernel } from '@luma.gl/graph'
import { expect, it, vi } from 'vitest'
import { Graph } from '../src'

it('preserves point paint and picking order when opaque cores hide overlapping points', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:64px;height:48px'
  document.body.append(host)
  const clicked = vi.fn()
  const graph = new Graph(host, {
    spaceSize: 64,
    pixelRatio: 1,
    fitViewOnInit: false,
    initialZoomLevel: 1,
    rescalePositions: false,
    pointDefaultSize: 20,
    backgroundColor: '#000000',
    enableSimulation: false,
    enableRenderLoop: false,
    transitionDuration: 0,
    onPointClick: clicked,
  })
  const draws = vi.spyOn(RenderKernel.prototype, 'draw')
  try {
    await graph.ready
    const count = 768
    const xy = new Float32Array(2 * count)
    const rgba = new Float32Array(4 * count)
    for (let i = 0; i < count; i++) {
      xy.set([12.25, 32.25], 2 * i)
      rgba.set([0, 0, 1, 1], 4 * i)
    }
    xy.set([44.25, 32.25, 45.5, 32.25])
    rgba.set([1, 0, 0, 1, 0, 1, 0, 0.5])
    graph.setPointPositions(xy, true)
    graph.setPointColors(rgba)
    graph.render(0, 0)
    const canvas = host.querySelector('canvas')!
    const copy = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d', { willReadFrequently: true })!
    const position = graph.spaceToScreenPosition([45, 32])
    const center = 4 * (Math.floor(position[1]) * canvas.width + Math.floor(position[0]))
    const { left, top } = canvas.getBoundingClientRect()
    const states = (): Array<string | undefined> => draws.mock.contexts
      .filter((kernel): kernel is RenderKernel => kernel instanceof RenderKernel)
      .map(kernel => kernel.pipeline.props.parameters?.depthCompare)
    function frame (): Uint8ClampedArray {
      draws.mockClear()
      graph.renderOneFrame()
      copy.drawImage(canvas, 0, 0)
      return copy.getImageData(0, 0, canvas.width, canvas.height).data
    }

    for (const order of [[0, 1], [1, 0]]) {
      graph.setPointRenderOrder(order)
      graph.render(0, 0)
      let reference: Uint8ClampedArray | undefined
      for (const enabled of [false, true]) {
        graph.setConfigPartial({ pointOcclusionCulling: enabled })
        const pixels = frame()
        expect(states()).toEqual(enabled ? ['less', 'less'] : ['always'])
        const expectedColor = order[1] === 0 ? [255, 0, 0, 255] : [127, 128, 0, 255]
        Array.from(pixels.subarray(center, center + 4)).forEach((value, i) => expect(Math.abs(value - expectedColor[i]!)).toBeLessThanOrEqual(1))
        if (reference) expect(pixels.findIndex((value, i) => value !== reference![i])).toBe(-1)
        reference = pixels

        clicked.mockClear()
        canvas.dispatchEvent(new MouseEvent('click', { clientX: left + position[0], clientY: top + position[1], bubbles: true }))
        await vi.waitFor(() => expect(clicked.mock.calls[0]?.[0]).toBe(order[1]))
      }
    }

    // A transparent or partly transparent image texel must leave prior paint
    // visible. A near-opaque fill still needs the normal blend operation.
    const image = new ImageData(Uint8ClampedArray.of(255, 255, 255, 0, 0, 0, 255, 128, 255, 255, 255, 255), 3, 1)
    graph.setImageData([image])
    graph.setPointImageIndices(Float32Array.from({ length: count }, (_, i) => i === 1 ? 0 : -1))
    graph.setPointImageSizes(Float32Array.from({ length: count }, (_, i) => i === 1 ? 14 : 0))
    rgba[7] = 0.999
    graph.setPointColors(rgba)
    graph.setPointRenderOrder([0, 1])
    graph.render(0, 0)
    graph.setConfigPartial({ pointOcclusionCulling: false })
    const paintedImage = frame()
    graph.setConfigPartial({ pointOcclusionCulling: true })
    expect(frame().findIndex((value, i) => value !== paintedImage[i])).toBe(-1)
    expect(states()).toEqual(['less', 'less'])

    // The prepass uses only depth that Graph owns. Deck and other callers may
    // already have geometry in the depth attachment of their open host pass.
    graph.setConfigPartial({ pointOcclusionCulling: true })
    const device = graph.simulation.device!
    const pass = device.beginRenderPass({ framebuffer: device.canvasContext!.getCurrentFramebuffer(), clearDepth: 0.5 })
    draws.mockClear()
    try { graph.drawToRenderPass(pass) } finally { pass.end() }
    expect(states()).toEqual(['always'])
    device.submit()

    graph.setConfigPartial({ highlightedPointIndices: [0] })
    frame()
    expect(states()).toEqual(['always'])
    graph.setConfigPartial({ highlightedPointIndices: undefined, pointOpacity: 0.5 })
    frame()
    expect(states()).toEqual(['always'])
    graph.setConfigPartial({ pointOpacity: 1 })
    graph.setPointSizes(new Float32Array(count).fill(1))
    graph.render(0, 0)
    frame()
    expect(states()).toEqual(['always'])

    graph.setPointSizes(new Float32Array(count).fill(20))
    graph.setPointImageIndices(new Float32Array(count).fill(-1))
    for (let i = 0; i < count; i++) rgba[4 * i + 3] = 0.4
    graph.setPointColors(rgba)
    graph.render(0, 0)
    frame()
    expect(states()).toEqual(['always'])
  } finally {
    draws.mockRestore()
    graph.destroy()
    host.remove()
  }
})
