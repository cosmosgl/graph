import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import source from './transition.wgsl?raw'
import {
  POINT_TRANSITION_DEFAULT_COLOR, POINT_TRANSITION_DEFAULT_SIZE, transitionAttributes, transitionFlags,
  type PointTransitionData, type PointTransitionRunner, type PointTransitionOutput,
} from './transition-state'

export async function createPointTransitionWebGPU (device: Device, initial: PointTransitionData): Promise<PointTransitionRunner> {
  const scope = resourceScope()
  const own = scope.own
  let previous = initial
  try {
    const sourcePosition = own(upload(device, initial.positions)); const targetPosition = own(upload(device, initial.positions))
    const sourceColor = own(upload(device, initial.colors)); const targetColor = own(upload(device, initial.colors))
    const attributes = own(upload(device, transitionAttributes(initial, initial)))
    const params = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
    const current = own(upload(device, initial.positions)); const styles = own(upload(device, new Float32Array(initial.positions.length * 2)))
    const kernel = own(await Kernel.createAsync(device, {
      source,
      shaderLayout: {
        bindings: bindingLayout([
          ['sourcePosition', 'read-only-storage'], ['targetPosition', 'read-only-storage'], ['sourceColor', 'read-only-storage'],
          ['targetColor', 'read-only-storage'], ['attributes', 'read-only-storage'], ['params', 'uniform'], ['current', 'storage'], ['styles', 'storage'],
        ]),
      },
    }))
    return {
      start (next): void {
        if (next.positions.length !== initial.positions.length) throw new Error('This transition study uses a fixed point count')
        device.commandEncoder.copyBufferToBuffer({ sourceBuffer: current, destinationBuffer: sourcePosition, size: current.byteLength })
        device.submit()
        targetPosition.write(next.positions); sourceColor.write(previous.colors); targetColor.write(next.colors)
        attributes.write(transitionAttributes(previous, next)); previous = next
      },
      async draw (frame): Promise<PointTransitionOutput> {
        params.write(new Float32Array([...transitionFlags(frame), ...POINT_TRANSITION_DEFAULT_COLOR,
          POINT_TRANSITION_DEFAULT_SIZE, initial.sizes.length, 0, 0]))
        const pass = device.beginComputePass()
        try {
          kernel.dispatch(pass, {
            x: Math.ceil(initial.sizes.length / 64),
            bindings: {
              sourcePosition, targetPosition, sourceColor, targetColor, attributes, params, current, styles,
            },
          })
        } finally { pass.end() }
        await waitForGpu(device)
        return { positions: await readFloats(current), styles: await readFloats(styles) }
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
