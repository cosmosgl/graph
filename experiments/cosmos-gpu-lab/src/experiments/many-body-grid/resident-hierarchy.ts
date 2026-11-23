import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { nearLimit, type Parameters } from '../many-body/data'
import type { TimestampWrites } from '../many-body/timing'
import { createSpatialGridResources, type GridPassTimestamps } from '../spatial-grid/resources'
import { createGpuBounds } from './bounds'
import { frameSamples, layout, type Structure } from './data'
import { fastForceSource } from './fast-force'
import { fieldLayout, withCellField, type DistantForce } from './resident-cell-field'
import { spatialOrderShader } from './spatial-order'
import { replaceOnce } from './trace'
import hierarchySource from './resident-hierarchy.wgsl?raw'
import normalizeSource from './resident-normalize.wgsl?raw'

// Experimental GPU-resident hierarchy. The finest-cell CSR index is rebuilt
// every tick; its point IDs are also the execution order for repulsion.
export async function createResidentHierarchy (
  device: Device, positions: Buffer[], samples: Buffer, forces: Buffer, count: number, p: Parameters, slotCount = 8,
  distantForce: DistantForce = 'per-point', coarseLevels?: number
): Promise<{
  readonly bytes: number;
  prepare(tick: number, alpha: number): void;
  encodeIndex(source: number, timestamps?: TimestampWrites, gridTimestamps?: GridPassTimestamps): void;
  encodeHierarchy(pass: ComputePass, source: number): void;
  encodeRepulsion(pass: ComputePass, source: number): void;
  encodeForce(pass: ComputePass, source: number): void;
  readStructure(): Promise<Structure>;
  readBounds(): Promise<Float32Array>;
  readCellCenters(limit: number): Promise<Float32Array>;
  readIndex(): ReturnType<Awaited<ReturnType<typeof createSpatialGridResources>>['readback']>;
  destroy(): void;
}> {
  if (!Number.isInteger(count) || count < 1 || count > 1000000 || slotCount !== 8) throw new Error('Invalid resident hierarchy size')
  const l = layout(count); const scope = resourceScope(); const own = scope.own
  try {
    let bytes = 0
    const storage = (size: number): Buffer => {
      bytes += size
      return own(device.createBuffer({ byteLength: Math.max(size, 16), usage: Buffer.STORAGE | Buffer.COPY_SRC | Buffer.COPY_DST }))
    }
    const box = storage(16); const normalized = storage(count * 8)
    const field = fieldLayout(l, distantForce, coarseLevels)
    const aggregates = storage(l.cells * 16); const centroids = storage((l.cells + field.cells * field.rows) * 16)
    const slots = storage(l.finest ** 2 * slotCount * 8)
    const levels = own(upload(device, new Uint32Array(l.sizes.flatMap((n, i) => [n, l.offsets[i], 0, 0]))))
    const params = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
    const normParams = own(upload(device, new Uint32Array([count, l.finest, 0, 0]), Buffer.UNIFORM))
    const fineParams = own(upload(device, new Uint32Array(8), Buffer.UNIFORM))
    const parentParams = l.sizes.slice(0, -1).map((_, level) => own(upload(device, new Uint32Array([
      count, l.finest, slotCount, 0, l.offsets[level], l.offsets[level + 1], l.sizes[level + 1], 0,
    ]), Buffer.UNIFORM)))
    const bounds = own(await createGpuBounds(device, count, l.finest, box))
    const grid = own(await createSpatialGridResources(device, [normalized], count, l.finest)); bytes += grid.gridBytes
    const normalize = own(await Kernel.createAsync(device, {
      source: normalizeSource,
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['normalized', 'storage'], ['params', 'uniform'], ['box', 'read-only-storage'],
        ]),
      },
    }))
    const fine = own(await Kernel.createAsync(device, {
      source: hierarchySource,
      entryPoint: 'fine',
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['offsets', 'read-only-storage'], ['indices', 'read-only-storage'],
          ['aggregates', 'storage'], ['slots', 'storage'], ['params', 'uniform'],
        ]),
      },
    }))
    const parent = own(await Kernel.createAsync(device, {
      source: hierarchySource,
      entryPoint: 'parent',
      shaderLayout: {
        bindings: [
          { name: 'aggregates', location: 3, group: 0, type: 'storage' },
          { name: 'params', location: 5, group: 0, type: 'uniform' },
        ],
      },
    }))
    let forceSource = spatialOrderShader(fastForceSource('native-both'))
    forceSource = replaceOnce(forceSource, 'var<uniform> box:', 'var<storage, read> box:')
    // Centroids retain the cell mass, so the force need not bind aggregates as
    // a ninth storage buffer when the box and execution order also reside on GPU.
    forceSource = replaceOnce(forceSource, 'let a = aggregates[cellIndex];', 'let a = centroids[cellIndex];')
    forceSource = replaceOnce(forceSource, 'let mass = aggregates[', 'let mass = centroids[')
    if (field.levels) forceSource = withCellField(forceSource, field.levels, distantForce === 'four-corners')
    const centroid = own(await Kernel.createAsync(device, {
      source: forceSource,
      entryPoint: 'centroidMain',
      shaderLayout: {
        bindings: [
          { name: 'aggregates', location: 4, group: 0, type: 'storage' },
          { name: 'params', location: 8, group: 0, type: 'uniform' },
          { name: 'centroids', location: 11, group: 0, type: 'storage' },
        ],
      },
    }))
    const buildField = field.levels && own(await Kernel.createAsync(device, {
      source: forceSource,
      entryPoint: 'buildCellField',
      shaderLayout: {
        bindings: [
          { name: 'levels', location: 7, group: 0, type: 'read-only-storage' },
          { name: 'params', location: 8, group: 0, type: 'uniform' },
          { name: 'box', location: 9, group: 0, type: 'read-only-storage' },
          { name: 'centroids', location: 11, group: 0, type: 'storage' },
        ],
      },
    }))
    const force = own(await Kernel.createAsync(device, {
      source: forceSource,
      entryPoint: 'forceMain',
      shaderLayout: {
        bindings: [
          { name: 'positions', location: 0, group: 0, type: 'read-only-storage' },
          { name: 'samples', location: 1, group: 0, type: 'read-only-storage' },
          { name: 'slots', location: 5, group: 0, type: 'storage' },
          { name: 'forces', location: 6, group: 0, type: 'storage' },
          { name: 'levels', location: 7, group: 0, type: 'read-only-storage' },
          { name: 'params', location: 8, group: 0, type: 'uniform' },
          { name: 'box', location: 9, group: 0, type: 'read-only-storage' },
          { name: 'centroids', location: 11, group: 0, type: 'storage' },
          { name: 'targetOrder', location: 12, group: 0, type: 'read-only-storage' },
        ],
      },
    }))
    const encodeHierarchy = (pass: ComputePass, source: number): void => {
      fine.dispatch(pass, {
        x: Math.ceil(l.finest ** 2 / 64),
        bindings: { positions: positions[source], offsets: grid.cellOffsets, indices: grid.pointIndices, aggregates, slots, params: fineParams },
      })
      for (let level = l.sizes.length - 2; level >= 0; level--) {
        parent.dispatch(pass, { x: Math.ceil(l.sizes[level] ** 2 / 64), bindings: { aggregates, params: parentParams[level] } })
      }
      centroid.dispatch(pass, { x: Math.ceil(l.cells / 64), bindings: { aggregates, centroids, params } })
      if (buildField) buildField.dispatch(pass, { x: Math.ceil(field.cells / 64), bindings: { levels, params, box, centroids } })
    }
    const encodeRepulsion = (pass: ComputePass, source: number): void => {
      force.dispatch(pass, {
        x: Math.ceil(count / 64),
        bindings: { positions: positions[source], samples, slots, forces, levels, params, box, centroids, targetOrder: grid.pointIndices },
      })
    }
    return {
      bytes,
      prepare (tick, alpha): void {
        if (!Number.isInteger(tick) || tick < 0 || !Number.isFinite(alpha) || alpha < 0) throw new Error('Invalid resident tick')
        bounds.prepare(tick)
        const seed = frameSamples(tick).seed; const bits = new Uint32Array(new Float32Array([seed]).buffer)[0]
        fineParams.write(new Uint32Array([count, l.finest, slotCount, bits, l.offsets.at(-1)!, 0, 0, 0]))
        params.write(new Float32Array([count, l.finest, l.sizes.length, slotCount, alpha, p.repulsion, nearLimit(count, p), 0, seed, l.cells, 0, 0]))
      },
      encodeIndex (source, timestamps, gridTimestamps): void {
        const pass = device.beginComputePass(timestamps)
        try {
          bounds.encode(pass, positions[source])
          normalize.dispatch(pass, { x: Math.ceil(count / 256), bindings: { positions: positions[source], normalized, params: normParams, box } })
        } finally { pass.end() }
        grid.encodeBuild(device.commandEncoder, 0, undefined, gridTimestamps)
        // A separate submission avoids the device loss observed when the large
        // index build and its consumer were encoded in a single submission.
        device.submit()
      },
      encodeHierarchy,
      encodeRepulsion,
      encodeForce (pass, source): void { encodeHierarchy(pass, source); encodeRepulsion(pass, source) },
      async readStructure (): Promise<Structure> { return { aggregates: await readFloats(aggregates), slots: await readFloats(slots) } },
      readBounds: (): Promise<Float32Array> => readFloats(box),
      readCellCenters: (limit): Promise<Float32Array> => readFloats(normalized, limit * 8),
      readIndex: (): ReturnType<typeof grid.readback> => grid.readback(),
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
