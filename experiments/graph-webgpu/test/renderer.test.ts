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
