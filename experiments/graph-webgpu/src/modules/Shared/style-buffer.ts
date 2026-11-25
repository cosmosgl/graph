import { Buffer, type Device } from '@luma.gl/core'

/** Reuse a sufficiently large buffer. The caller releases any superseded allocation after committing the update. */
export function updateStyleBuffer (device: Device, old: Buffer | undefined, values: Float32Array | Uint32Array, id: string, minBytes: number): Buffer {
  const bytes = Math.max(minBytes, values.byteLength)
  if (bytes > device.limits.maxStorageBufferBindingSize) {
    throw new Error(`${id} requires ${bytes} bytes of storage (device limit ${device.limits.maxStorageBufferBindingSize})`)
  }
  if (old && old.byteLength >= bytes) {
    if (values.length) old.write(values)
    return old
  }
  const next = device.createBuffer({ id, byteLength: bytes, usage: Buffer.STORAGE | Buffer.COPY_DST | Buffer.COPY_SRC })
  try {
    if (values.length) next.write(values)
  } catch (e) {
    next.destroy()
    throw e
  }
  return next
}
