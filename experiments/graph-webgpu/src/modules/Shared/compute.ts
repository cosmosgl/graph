import { Buffer, type BindingDeclaration, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { resourceScope } from './resource-scope'

export function upload (device: Device, values: Float32Array | Uint32Array, usage: number = Buffer.STORAGE): Buffer {
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
