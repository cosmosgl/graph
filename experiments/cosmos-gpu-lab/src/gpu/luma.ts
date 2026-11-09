import {
  Buffer, luma, type Device, type CanvasContext, type BindingDeclaration, type PrimitiveTopology, type RenderPipelineParameters, type TextureFormatColor,
} from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/engine'
import { webgl2Adapter } from '@luma.gl/webgl'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'

export async function createDevice (
  type: 'webgl' | 'webgpu', canvas?: HTMLCanvasElement, timestamps = true, onError?: (error: Error) => unknown
): Promise<Device> {
  return await luma.createDevice({
    type,
    adapters: type === 'webgl' ? [webgl2Adapter] : [webgpuAdapter],
    waitForPageLoad: false,
    optionalFeatures: timestamps ? ['timestamp-query'] : [],
    ...(onError ? { onError } : {}),
    featureLevel: 'core',
    createCanvasContext: canvas ? { canvas, autoResize: false, useDevicePixels: false, alphaMode: 'opaque' } : undefined,
    webgl: { antialias: false, alpha: false, depth: false, stencil: false },
  })
}

export function bindingLayout (entries: Array<[string, 'storage' | 'read-only-storage' | 'uniform']>): BindingDeclaration[] {
  return entries.map(([name, type], location) => (type === 'uniform' ? { name, type, location, group: 0 } : { name, type, location, group: 0 }))
}

export function upload (device: Device, data: Float32Array | Uint32Array | Uint8Array, usage = Buffer.STORAGE): Buffer {
  const buffer = device.createBuffer({ byteLength: Math.max(16, data.byteLength), usage: usage | Buffer.COPY_DST | Buffer.COPY_SRC })
  if (data.byteLength) buffer.write(data)
  return buffer
}

export async function readFloats (buffer: Buffer, byteLength = buffer.byteLength): Promise<Float32Array> {
  const bytes = await buffer.readAsync(0, byteLength)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice()
}

// One loss listener per device; completed benchmark waits must not accumulate pending promise callbacks.
const lossListeners = new WeakMap<Device, Set<() => void>>()

export async function waitForGpu (device: Device, timeoutMs = 5000): Promise<void> {
  if (device.isLost) throw new Error('GPU device lost before completion wait')
  const fence = device.createFence()
  let listeners = lossListeners.get(device)
  if (!listeners) {
    listeners = new Set(); lossListeners.set(device, listeners)
    const active = listeners
    device.lost.then(() => { for (const notify of active) notify(); active.clear() })
  }
  let onLoss: () => void = () => {}
  const lost = new Promise<never>((resolve, reject) => {
    onLoss = (): void => { reject(new Error('GPU device lost during completion wait')) }
    listeners.add(onLoss)
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    device.submit()
    await Promise.race([
      fence.signaled,
      lost,
      new Promise<never>((resolve, reject) => { timeout = setTimeout(() => reject(new Error('GPU completion timeout')), timeoutMs) }),
    ])
    if (device.isLost) throw new Error('GPU device lost during completion wait')
  } finally { clearTimeout(timeout); listeners.delete(onLoss); fence.destroy() }
}

// Storage-buffer renderers have no vertex attributes but still require a luma VertexArray.
export function createStorageRenderer (
  device: Device, source: string, topology: PrimitiveTopology, bindings: BindingDeclaration[],
  parameters: RenderPipelineParameters = {}, canvasContext?: CanvasContext
): { kernel: RenderKernel; vertexArray: ReturnType<Device['createVertexArray']>; destroy(): void } {
  const shaderLayout = { attributes: [], bindings }
  const target = (canvasContext ?? (device as WebGPUDevice).canvasContext)!.getCurrentFramebuffer()
  const kernel = new RenderKernel(device, {
    vertexSource: source,
    fragmentSource: source,
    vertexEntryPoint: 'vertexMain',
    fragmentEntryPoint: 'fragmentMain',
    topology,
    shaderLayout,
    parameters: { depthWriteEnabled: false, depthCompare: 'always', ...parameters },
    colorAttachmentFormats: [target.colorAttachments[0].texture.format as TextureFormatColor],
  })
  const vertexArray = device.createVertexArray({ shaderLayout, bufferLayout: [] })
  return { kernel, vertexArray, destroy (): void { kernel.destroy(); vertexArray.destroy() } }
}

export const ALPHA_BLEND: RenderPipelineParameters = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
}
