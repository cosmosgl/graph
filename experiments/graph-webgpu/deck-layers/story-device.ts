import { luma, type Device } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'

/** Deck and every graph in a story borrow one native WebGPU device and canvas. */
export async function createStoryDevice (parent: HTMLDivElement): Promise<{
  props: { parent: HTMLDivElement; canvas: HTMLCanvasElement; device: Device }; destroy(): void;
}> {
  const canvas = parent.ownerDocument.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    createCanvasContext: { canvas, alphaMode: 'premultiplied', autoResize: true },
  })
  parent.prepend(canvas)
  return {
    props: { parent, canvas, device },
    destroy (): void { device.destroy(); canvas.remove() },
  }
}
