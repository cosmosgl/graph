import { Buffer, luma, Texture, type Device, type Framebuffer } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../../../src/config'
import { GraphData } from '../../../src/modules/GraphData'
import { GraphRenderer, type GraphView } from '../src/renderer'

interface Scene {
  data: GraphData;
  view: GraphView;
  device: Device;
  renderer: GraphRenderer;
  framebuffer: Framebuffer;
  positions: Buffer;
  readPixel: (x: number, y: number) => Promise<number[]>;
  errors: string[];
  destroy: () => void;
}

async function createScene (config = createDefaultConfig()): Promise<Scene> {
  const errors: string[] = []
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    onError: err => { errors.push(err.message); return true },
  })
  Object.assign(config, {
    curvedLinks: true,
    curvedLinkWeight: 1,
    curvedLinkControlPointDistance: 0.5,
    curvedLinkSegments: 20,
    linkDefaultWidth: 6,
    linkVisibilityMinTransparency: 1,
    linkDefaultColor: '#00ff00',
    pointDefaultSize: 18,
  })
  const data = new GraphData(config)
  data.inputPointPositions = new Float32Array([16, 32, 80, 32, 16, 32])
  data.inputPointColors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1])
  data.inputLinks = new Float32Array([0, 1])
  data.update()
  const positions = device.createBuffer({
    data: new Float32Array([16, 32, 1, 0, 80, 32, 0, 0, 16, 32, 0, 0]),
    usage: Buffer.STORAGE | Buffer.COPY_DST,
  })
  const renderer = new GraphRenderer(device, data, config, () => ({ buffer: positions, pointCount: 3 }))
  const texture = device.createTexture({ width: 192, height: 128, format: 'rgba8unorm', usage: Texture.RENDER | Texture.COPY_SRC })
  const framebuffer = device.createFramebuffer({ width: 192, height: 128, colorAttachments: [texture] })
  const pixel = device.createBuffer({ byteLength: 256, usage: Buffer.COPY_DST | Buffer.COPY_SRC })
  const view = { width: 96, height: 64, x: 0, y: 64, scale: 1, pixelRatio: 2 }
  const readPixel = async (x: number, y: number): Promise<number[]> => {
    device.commandEncoder.copyTextureToBuffer({
      sourceTexture: texture, origin: [x, y, 0], destinationBuffer: pixel, width: 1, height: 1, bytesPerRow: 256,
    })
    device.submit()
    return Array.from(await pixel.readAsync(0, 4))
  }
  renderer.update()
  function destroy (): void {
    renderer.destroy()
    pixel.destroy()
    framebuffer.destroy()
    texture.destroy()
    positions.destroy()
    device.destroy()
  }
  return { data, view, device, renderer, framebuffer, positions, readPixel, errors, destroy }
}

it('draws live GPU positions, preserves overlap order and picks a curved stroke at DPR 2', async () => {
  const scene = await createScene()
  const { data, view, device, renderer, framebuffer, positions, readPixel, errors } = scene
  try {
    renderer.draw(view, framebuffer)
    expect(await readPixel(32, 64)).toEqual([255, 255, 0, 255])
    expect(await renderer.pick(16, 32, view)).toEqual({ kind: 'point', index: 2 })
    expect(await renderer.pick(48, 16, view)).toEqual({ kind: 'link', index: 0 })
    expect(await renderer.pick(48, 32, view)).toBeNull()

    // The embedding host can record visual and picking draws with different cameras before it submits.
    const hostPass = device.beginRenderPass({ framebuffer, clearColor: [1, 0, 1, 1] })
    renderer.drawToRenderPass(hostPass, view, { points: false, picking: { alpha: 7 / 255, linkIndexOffset: 80 } })
    renderer.drawToRenderPass(hostPass, { ...view, x: 8 }, { links: false, picking: { alpha: 6 / 255 } })
    hostPass.end()
    expect(await readPixel(96, 32)).toEqual([81, 0, 0, 7])
    expect(await readPixel(48, 64)).toEqual([3, 0, 0, 6])
    expect(await readPixel(1, 1)).toEqual([255, 0, 255, 255])

    data.inputPointRenderOrder = [0]
    data.updatePointRenderOrder()
    renderer.update()
    expect(await renderer.pick(16, 32, view)).toEqual({ kind: 'point', index: 0 })
    positions.write(new Float32Array([0, 0, 0, 1]), 0)
    expect(await renderer.pick(16, 32, view)).toEqual({ kind: 'point', index: 2 })
    expect(await renderer.pick(48, 16, view)).toBeNull()
    expect(errors).toEqual([])
  } finally { scene.destroy() }
})

it('uses the nearest occupied circle sample for pointer picks before considering the link under the cursor', async () => {
  const config = createDefaultConfig()
  const scene = await createScene(config)
  const { view, data, renderer, positions } = scene
  try {
    config.curvedLinks = false
    data.inputPointSizes = Float32Array.of(16, 4, 16)
    data.update()
    renderer.update()
    for (const pixelRatio of [1, 2]) {
      const camera = { ...view, pixelRatio }
      // Both overlapping points end at x=24. Their pick window still reaches the link at x=30.
      expect(await renderer.pick(30, 32, camera)).toEqual({ kind: 'point', index: 2 })
      expect(await renderer.pick(38, 32, camera)).toEqual({ kind: 'link', index: 0 })
    }
    data.inputPointRenderOrder = [0]
    data.updatePointRenderOrder()
    renderer.update()
    expect(await renderer.pick(30, 32, view)).toEqual({ kind: 'point', index: 0 })

    // Two tiny points compete in one window. Nearer samples win, then the lower-left scan order breaks ties.
    positions.write(Float32Array.of(60, 37, 0, 0, 60, 27, 0, 0, 0, 0, 0, 1))
    data.inputPointSizes = Float32Array.of(1, 1, 1)
    data.inputPointColors = new Float32Array(12) // Pointer circles follow the target size, even with transparent paint.
    data.update()
    renderer.update()
    expect(await renderer.pick(60, 30, view)).toEqual({ kind: 'point', index: 0 })
    expect(await renderer.pick(60, 32, view)).toEqual({ kind: 'point', index: 1 })
    expect(await renderer.pick(60, 34, view)).toEqual({ kind: 'point', index: 1 })
    expect(scene.errors).toEqual([])
  } finally { scene.destroy() }
})

it('keeps the displayed scene usable when replacing the image atlas fails', async () => {
  const config = createDefaultConfig()
  const scene = await createScene(config)
  const { data, view, device, renderer, framebuffer, readPixel } = scene
  const allocation = vi.spyOn(device, 'createTexture')
  try {
    renderer.draw(view, framebuffer)
    const background = await readPixel(0, 0)
    config.backgroundColor = '#ff00ff'
    data.inputImageData = [new ImageData(1, 1)]
    allocation.mockImplementationOnce(() => { throw new Error('atlas allocation failed') })
    expect(() => renderer.update()).toThrow('atlas allocation failed')
    renderer.draw(view, framebuffer)
    expect(await readPixel(0, 0)).toEqual(background)
    renderer.update()
    renderer.draw(view, framebuffer)
    expect(await readPixel(0, 0)).toEqual([255, 0, 255, 255])
  } finally { allocation.mockRestore(); scene.destroy() }
})

it('matches every RGBA byte of the general link shader for overlapping solid strokes', async () => {
  const config = createDefaultConfig()
  const scene = await createScene(config)
  const { data, device, framebuffer, positions, renderer, view } = scene
  const { width, height } = framebuffer
  const bytesPerRow = width * 4
  const pixels = device.createBuffer({ byteLength: bytesPerRow * height, usage: Buffer.COPY_SRC | Buffer.COPY_DST })
  async function capture (hoveredLink?: number): Promise<Uint8Array> {
    const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
    renderer.drawToRenderPass(pass, { ...view, hoveredLink }, { points: false })
    pass.end()
    device.commandEncoder.copyTextureToBuffer({
      sourceTexture: framebuffer.colorAttachments[0]!.texture, destinationBuffer: pixels, width, height, bytesPerRow,
    })
    device.submit()
    return (await pixels.readAsync()).slice()
  }
  try {
    // Hover takes the general path. A zero width increase and unchanged color preserve its appearance.
    config.hoveredLinkWidthIncrease = 0
    config.hoveredLinkColor = undefined
    data.inputLinks = new Float32Array([0, 1, 1, 2, 2, 0, 0, 1])
    data.inputLinkWidths = new Float32Array([0.625, 1.125, 3.25, 1.875])
    positions.write(new Float32Array([9.625, 23.2, 0, 0, 76.125, 39.1, 0, 0, 42.25, 11.375, 0, 0]))
    for (const colors of [
      [1, 0.1, 0, 0.5, 0, 0.8, 0.2, 0.75, 0, 0.1, 1, 1, 1, 0.2, 1, 0.375],
      // Uniform RGB still preserves per-link alpha, width, focus and curvature.
      [0.4, 0.2, 0.7, 0.5, 0.4, 0.2, 0.7, 0.75, 0.4, 0.2, 0.7, 1, 0.4, 0.2, 0.7, 0.375],
    ]) {
      data.inputLinkColors = new Float32Array(colors)
      data.update()
      renderer.update()
      for (const curved of [false, true]) {
        config.curvedLinks = curved
        config.focusedLinkIndex = curved ? 2 : undefined
        const reference = await capture(0)
        expect(reference.some(v => v !== 0)).toBe(true)
        const solid = await capture()
        expect(solid.findIndex((value, i) => value !== reference[i])).toBe(-1)
      }
    }
    expect(scene.errors).toEqual([])
  } finally { pixels.destroy(); scene.destroy() }
})

it('interpolates point colors and retargets an interrupted update from the displayed frame', async () => {
  const scene = await createScene()
  const { data, view, renderer, framebuffer, readPixel, errors } = scene
  try {
    data.inputPointColors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1])
    data.update()
    renderer.update({ animate: true })
    renderer.draw({ ...view, styleProgress: 0.5 }, framebuffer)
    const halfway = await readPixel(32, 64)
    expect(halfway).toEqual([255, 128, 0, 255])

    data.inputPointColors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1])
    data.update()
    renderer.update({ animate: true, previousProgress: 0.5 })
    renderer.draw({ ...view, styleProgress: 0 }, framebuffer)
    expect(await readPixel(32, 64)).toEqual(halfway)
    renderer.draw({ ...view, styleProgress: 1 }, framebuffer)
    expect(await readPixel(32, 64)).toEqual([0, 0, 255, 255])
    expect(errors).toEqual([])
  } finally { scene.destroy() }
})

it('matches full uploads when width edits interrupt a mixed point and link transition', async () => {
  const optimized = await createScene()
  const reference = await createScene()
  const scenes = [optimized, reference]
  const readbacks = scenes.map(({ device, framebuffer }) => device.createBuffer({
    byteLength: framebuffer.width * framebuffer.height * 4, usage: Buffer.COPY_DST | Buffer.COPY_SRC,
  }))
  async function compareFrame (styleProgress: number): Promise<Uint8Array> {
    const captures = await Promise.all(scenes.map(async ({ renderer, framebuffer, device, view }, i) => {
      const drawView = { ...view, styleProgress }
      renderer.draw(drawView, framebuffer)
      device.commandEncoder.copyTextureToBuffer({
        sourceTexture: framebuffer.colorAttachments[0]!.texture,
        destinationBuffer: readbacks[i]!,
        width: framebuffer.width,
        height: framebuffer.height,
        bytesPerRow: framebuffer.width * 4,
      })
      device.submit()
      return { pixels: (await readbacks[i]!.readAsync()).slice(), pick: await renderer.pick(48, 21, drawView) }
    }))
    expect(captures[0]!.pixels.findIndex((v, i) => v !== captures[1]!.pixels[i])).toBe(-1)
    expect(captures[0]!.pick).toEqual(captures[1]!.pick)
    return captures[0]!.pixels
  }
  try {
    for (const { data, renderer } of scenes) {
      data.inputPointColors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1])
      data.inputLinkColors = Float32Array.of(0, 0, 1, 1)
      data.inputLinkWidths = Float32Array.of(14)
      data.update()
      renderer.update({ animate: true })
    }
    const halfway = await compareFrame(0.5)
    for (const scene of scenes) {
      scene.data.inputLinkWidths = Float32Array.of(NaN) // Reset this link to its configured default.
      scene.data.updateLinkWidth()
      scene.renderer.update({ animate: true, previousProgress: 0.5, linkWidthsOnly: scene === optimized })
    }
    expect((await compareFrame(0)).findIndex((v, i) => v !== halfway[i])).toBe(-1)
    await compareFrame(0.5)
    // Interrupt the narrow update with a mixed one before the link width reaches its target.
    for (const { data, renderer } of scenes) {
      data.inputPointSizes = Float32Array.of(30, 30, 30)
      data.inputLinkWidths = Float32Array.of(2)
      data.update()
      renderer.update({ animate: true, previousProgress: 0.5 })
    }
    await compareFrame(0)
    await compareFrame(1)
    expect(scenes.flatMap(scene => scene.errors)).toEqual([])
  } finally {
    readbacks.forEach(buffer => buffer.destroy())
    scenes.forEach(scene => scene.destroy())
  }
})

it('applies a highlight to the target style and invalidates a pick from the preceding frame', async () => {
  const config = createDefaultConfig()
  const scene = await createScene(config)
  const { data, view, renderer, framebuffer, readPixel } = scene
  try {
    data.inputPointColors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1])
    data.update()
    renderer.update({ animate: true })
    const halfway = { ...view, styleProgress: 0.5 }
    renderer.draw(halfway, framebuffer)
    expect(await readPixel(32, 64)).toEqual([128, 128, 128, 255])

    const pendingPick = renderer.pick(16, 32, halfway)
    config.highlightedPointIndices = [2]
    renderer.updatePointHighlights()
    expect(await pendingPick).toBeNull()
    renderer.draw(halfway, framebuffer)
    expect(await readPixel(32, 64)).toEqual([0, 0, 255, 255])
    expect(await renderer.pick(16, 32, halfway)).toEqual({ kind: 'point', index: 2 })
    expect(scene.errors).toEqual([])
  } finally { scene.destroy() }
})
