import type { BindingDeclaration, Device } from '@luma.gl/core'
import { Computation, type Kernel } from '@luma.gl/engine'
import { fp64arithmetic, type ShaderModule } from '@luma.gl/shadertools'

export async function createRoundedKernel (device: Device, source: string, bindings: BindingDeclaration[]): Promise<Pick<Kernel, 'dispatch' | 'destroy'>> {
  const computation = await Computation.createAsync(device, {
    source,
    // The pinned module's concrete uniform type is narrower than Computation's generic slot.
    modules: [fp64arithmetic as unknown as ShaderModule],
    defines: { LUMA_FP64_INTEGER_ARITHMETIC: true },
    shaderLayout: { bindings },
  })
  try { computation.updateShaderInputs() } catch (error) { computation.destroy(); throw error }
  return {
    dispatch (pass, options): void { computation.setBindings(options.bindings!); computation.dispatch(pass, options.x ?? 1, options.y, options.z) },
    destroy (): void { computation.destroy() },
  }
}
