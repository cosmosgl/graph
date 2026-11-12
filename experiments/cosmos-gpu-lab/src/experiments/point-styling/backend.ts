import { Buffer, Texture, type Device, type Framebuffer } from '@luma.gl/core'
import { HEIGHT, WIDTH, type Point, type Settings } from './data'
export type Snapshot = { width: number; height: number; color: Uint8Array; ids: Uint8Array }
export type Backend = {
  info: string; render(points: Point[], settings: Settings): Promise<Snapshot>; destroy(): void;
}
export function target (device: Device, width: number, height: number): { texture: Texture; framebuffer: Framebuffer; destroy(): void } {
  const texture = device.createTexture({ width, height, format: 'rgba8unorm', usage: Texture.RENDER | Texture.COPY_SRC })
  try {
    const framebuffer = device.createFramebuffer({ width, height, colorAttachments: [texture] })
    return { texture, framebuffer, destroy (): void { framebuffer.destroy(); texture.destroy() } }
  } catch (error) { texture.destroy(); throw error }
}
export async function pixels (device: Device, texture: Texture, framebuffer: Framebuffer): Promise<Uint8Array> {
  const { width, height } = texture; const stride = Math.ceil(width * 4 / 256) * 256
  if (device.type === 'webgl') {
    const raw = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array
    const result = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) result.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
    return result
  }
  const buffer = device.createBuffer({ byteLength: stride * height, usage: Buffer.COPY_DST | Buffer.COPY_SRC })
  try {
    device.commandEncoder.copyTextureToBuffer({ sourceTexture: texture, destinationBuffer: buffer, width, height, bytesPerRow: stride })
    device.submit()
    const raw = await buffer.readAsync(); const result = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) result.set(raw.subarray(y * stride, y * stride + width * 4), y * width * 4)
    return result
  } finally { buffer.destroy() }
}
export function pick (snapshot: Snapshot, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= snapshot.width || y >= snapshot.height) return null
  const offset = (Math.floor(y) * snapshot.width + Math.floor(x)) * 4
  const id = snapshot.ids[offset] + snapshot.ids[offset + 1] * 256 + snapshot.ids[offset + 2] * 65536
  return id ? id - 1 : null
}
export function dimensions (settings: Settings): [number, number] { return [WIDTH * settings.ratio, HEIGHT * settings.ratio] }
