import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { replaceOnce } from '../many-body-grid/trace'
import { createRoundedKernel } from './spring-precision'
import { refinedGravitySource } from './gravity-source'
import reduceSource from './center-reduce.wgsl?raw'
export async function createCenterWebGPU (device: Device, initialCount: number, forces: Buffer): Promise<{
  resize(count: number): void; encode(pass: ComputePass, positions: Buffer, alpha: number, strength: number): void;
  read(): Promise<Float32Array>; destroy(): void;
}> {
  const scope = resourceScope(); const own = scope.own
  let count = initialCount; let result: Buffer | undefined
  let levels: Array<{ output: Buffer; params: Buffer; groups: number }> = []
  try {
    result = own(device.createBuffer({ byteLength: 16, usage: Buffer.STORAGE | Buffer.COPY_SRC | Buffer.COPY_DST }))
    const params = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const reduce = own(await Kernel.createAsync(device, {
      source: reduceSource,
      shaderLayout: {
        bindings: bindingLayout([
          ['input', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform'],
        ]),
      },
    }))
    let forceSource = replaceOnce(refinedGravitySource, 'let delta = -positions[id.x].xy;', `
  let sum = centermass[0];
  if (sum.z == 0.) { forces[id.x] = vec4f(0.); return; }
  let center = vec2f(springDiv(sum.x, sum.z), springDiv(sum.y, sum.z));
  let delta = vec2f(springSub(center.x, positions[id.x].x), springSub(center.y, positions[id.x].y));`)
    forceSource = replaceOnce(forceSource, 'distance), 0.1);', 'distance), 0.01);')
    forceSource += '\n@group(0) @binding(3) var<storage, read> centermass: array<vec4f>;\n'
    const force = own(await createRoundedKernel(device, forceSource, bindingLayout([
      ['positions', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'], ['centermass', 'read-only-storage'],
    ])))
    const resize = (nextCount: number): void => {
      const next: typeof levels = []
      try {
        let n = nextCount
        do {
          const groups = Math.max(1, Math.ceil(n / 256))
          const output = groups === 1 ? result! : device.createBuffer({ byteLength: groups * 16, usage: Buffer.STORAGE })
          let parameters: Buffer
          try { parameters = upload(device, new Uint32Array([n, next.length === 0 ? 1 : 0, 0, 0]), Buffer.UNIFORM) } catch (error) {
            if (output !== result) output.destroy(); throw error
          }
          next.push({ output, params: parameters, groups }); n = groups
        } while (n > 1)
      } catch (error) { next.forEach(l => { l.params.destroy(); if (l.output !== result) l.output.destroy() }); throw error }
      levels.forEach(l => { l.params.destroy(); if (l.output !== result) l.output.destroy() }); levels = next
      count = nextCount
      if (!count) result!.write(new Float32Array(4))
      params.write(new Float32Array([count, 0, 0, 0]))
    }
    resize(initialCount)
    return {
      resize,
      encode (pass, positions, alpha, strength): void {
        params.write(new Float32Array([count, alpha, strength, 0]))
        let source = positions
        for (const level of levels) {
          reduce.dispatch(pass, { x: level.groups, bindings: { input: source, output: level.output, params: level.params } }); source = level.output
        }
        force.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, params, forces, centermass: result! } })
      },
      read: () => readFloats(result!),
      destroy (): void { levels.forEach(l => { l.params.destroy(); if (l.output !== result) l.output.destroy() }); levels = []; scope.destroy() },
    }
  } catch (error) { levels.forEach(l => { l.params.destroy(); if (l.output !== result) l.output.destroy() }); scope.destroy(); throw error }
}
