import { Buffer, Texture, luma } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { expect, it, vi } from 'vitest'
import { Graph } from '../src'

it('updates highlight colors and pick order on resident point and link buffers', async () => {
  const errors: string[] = []
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    onError: error => { errors.push(error.message); return true },
  })
  const width = 128
  const height = 64
  const target = device.createTexture({ width, height, format: 'rgba8unorm', usage: Texture.RENDER | Texture.COPY_SRC })
  const framebuffer = device.createFramebuffer({ width, height, colorAttachments: [target] })
  const pixels = device.createBuffer({ byteLength: width * height * 4, usage: Buffer.COPY_SRC | Buffer.COPY_DST })
  const allocations = vi.spyOn(device, 'createBuffer')
  // Keep the scene small on screen while exercising separate 32-point change masks and a partial last word.
  const pointCount = 97
  const positions = new Float32Array(pointCount * 2).fill(-256)
  const colors = new Float32Array(pointCount * 4).fill(1)
  positions.set([24, 64], 0)
  positions.set([24, 64], 31 * 2)
  positions.set([104, 64], 64 * 2)
  positions.set([68, 44], 96 * 2)
  colors.set([1, 0, 0, 1], 0)
  colors.set([0, 1, 0, 1], 31 * 4)
  colors.set([0.1, 0.25, 1, 1], 64 * 4)
  colors.set([1, 0.8, 0.1, 1], 96 * 4)
  const imageIndices = new Float32Array(pointCount).fill(-1)
  imageIndices[96] = 0
  const imageSizes = new Float32Array(pointCount)
  imageSizes[96] = 12
  function scene (): Graph {
    const graph = new Graph(null, {
      enableSimulation: false,
      rescalePositions: false,
      spaceSize: 128,
      pixelRatio: 1,
      pointDefaultSize: 16,
      pointDefaultStrokeWidth: 1.25,
      linkDefaultWidth: 5,
      linkVisibilityMinTransparency: 1,
      linkColorInterpolateFromEndpoints: true,
      backgroundColor: '#e0e8fc',
    }, Promise.resolve(device))
    graph.setPointPositions(positions)
    graph.setPointColors(colors)
    graph.setPointRenderOrder([0])
    graph.setImageData([new ImageData(Uint8ClampedArray.of(15, 127, 155, 200), 1, 1)])
    graph.setPointImageIndices(imageIndices)
    graph.setPointImageSizes(imageSizes)
    graph.setLinks(new Float32Array([0, 64, 31, 96]))
    graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
    graph.render()
    return graph
  }
  async function capture (graph: Graph, picking = false): Promise<Uint8Array> {
    const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
    try { graph.drawToRenderPass(pass, picking ? { picking: { alpha: 1, linkIndexOffset: pointCount } } : {}) } finally { pass.end() }
    device.commandEncoder.copyTextureToBuffer({ sourceTexture: target, destinationBuffer: pixels, width, height, bytesPerRow: width * 4 })
    device.submit()
    return (await pixels.readAsync()).slice()
  }
  const graph = scene()
  let reference: Graph | undefined
  function styleBuffersSince (first = 0): Buffer[] {
    return allocations.mock.results.slice(first).flatMap(result => {
      if (result.type === 'return' && ['cosmos-point-style', 'cosmos-link-style'].includes(result.value.id)) return [result.value]
      return []
    })
  }
  try {
    await graph.ready
    const stableBuffers = styleBuffersSince()
    expect(stableBuffers).toHaveLength(2)
    const writes = stableBuffers.map(buffer => vi.spyOn(buffer, 'write'))
    reference = scene()
    await reference.ready
    const initial = await capture(graph)
    const overlap = (32 * width + 24) * 4
    expect(Array.from(initial.slice(overlap, overlap + 4))).toEqual([255, 0, 0, 255])

    const states: Array<{ ids: number[] | undefined; front: number }> = [
      { ids: [31, 64, 64, pointCount, -1, 0.5], front: 31 },
      { ids: [64, 0, 31], front: 0 },
      { ids: [], front: 0 },
      { ids: undefined, front: 0 },
    ]
    const reusedIds: number[] = []
    for (const grey of [undefined, '#8342bda0']) {
      for (const current of [graph, reference]) current.setConfigPartial({ pointGreyoutColor: grey, pointGreyoutOpacity: grey ? 0.625 : undefined })
      for (const { ids, front } of states) {
        if (ids) reusedIds.splice(0, reusedIds.length, ...ids)
        writes.forEach(write => write.mockClear())
        const firstAllocation = allocations.mock.results.length
        graph.setConfigPartial({ highlightedPointIndices: ids && reusedIds })
        expect(styleBuffersSince(firstAllocation)).toHaveLength(0)
        writes.forEach(write => expect(write).not.toHaveBeenCalled())
        expect(stableBuffers.every(buffer => !buffer.destroyed)).toBe(true)

        reference.setConfigPartial({ highlightedPointIndices: ids })
        reference.render(undefined, 0)
        const color = await capture(graph)
        const full = await capture(reference)
        expect(color.findIndex((value, i) => value !== full[i])).toBe(-1)
        if (ids?.length === 0) expect(color[overlap]).not.toBe(initial[overlap])
        const pick = await capture(graph, true)
        const fullPick = await capture(reference, true)
        expect(pick.findIndex((value, i) => value !== fullPick[i])).toBe(-1)
        expect(pick[overlap]).toBe(front + 1)
      }
    }

    // Changing highlight membership must use the displayed style and order until render commits pending data.
    graph.setPointColors(new Float32Array(pointCount * 4).fill(1))
    graph.setPointRenderOrder([31])
    graph.setConfigPartial({ highlightedPointIndices: [0, 31] })
    reference.setConfigPartial({ highlightedPointIndices: [0, 31] })
    reference.render(undefined, 0)
    const old = await capture(reference)
    expect((await capture(graph)).findIndex((value, i) => value !== old[i])).toBe(-1)
    graph.render(undefined, 0)
    expect((await capture(graph, true))[overlap]).toBe(32)
    expect((await capture(graph)).slice(overlap, overlap + 4)).toEqual(Uint8Array.of(255, 255, 255, 255))
    expect(errors).toEqual([])
  } finally {
    graph.destroy()
    reference?.destroy()
    allocations.mockRestore()
    framebuffer.destroy()
    target.destroy()
    pixels.destroy()
    device.destroy()
  }
})
