import { Buffer, type BindingDeclaration, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { resourceScope } from './resource-scope'

export interface WorkgroupGrid { x: number; y: number }

/** Lay out a linear job in rows without exceeding the device's per-axis limit. */
export function workgroupGrid (groupCount: number, maxPerDimension: number): WorkgroupGrid {
  const y = Math.max(1, Math.ceil(groupCount / maxPerDimension))
  if (y > maxPerDimension) throw new RangeError('The compute dispatch exceeds this WebGPU device’s two-dimensional workgroup limit.')
  return { x: Math.ceil(groupCount / y), y }
}

export function assertStorageSize (device: Device, bytes: number, name: string): void {
  const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  if (bytes > limit) throw new RangeError(`${name} requires ${bytes} bytes of storage (device limit ${limit}).`)
}

export function upload (device: Device, values: Float32Array | Uint32Array, usage: number = Buffer.STORAGE): Buffer {
  if (usage & Buffer.STORAGE) assertStorageSize(device, values.byteLength, 'Storage buffer')
  const buffer = device.createBuffer({
    byteLength: Math.max(16, values.byteLength),
    usage: usage | Buffer.COPY_DST | Buffer.COPY_SRC,
  })
  try {
    if (values.length) buffer.write(values)
    return buffer
  } catch (error) {
    buffer.destroy()
    throw error
  }
}

type BindingKind = 'read-only-storage' | 'storage' | 'uniform'
export type Decl = [string, BindingKind, number?]
export function kernel (device: Device, scope: ReturnType<typeof resourceScope>, source: string, entryPoint: string, declarations: Decl[]): Kernel {
  const bindings: BindingDeclaration[] = declarations.map(([name, type, location], index) => {
    const slot = { name, location: location ?? index, group: 0 }
    return type === 'uniform' ? { ...slot, type: 'uniform' } : { ...slot, type }
  })
  return scope.own(new Kernel(device, { id: `cosmos-${entryPoint}`, source, entryPoint, shaderLayout: { bindings } }))
}
