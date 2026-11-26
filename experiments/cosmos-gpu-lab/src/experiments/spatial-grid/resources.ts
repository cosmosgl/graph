import { Buffer, type Device, type CommandEncoder, type Bindings, type ComputePassProps } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { describeDevice, bindingLayout, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import clearShader from './shaders/clear.wgsl?raw'
import addBlockOffsetsShader from './shaders/add-block-offsets.wgsl?raw'
import countShader from './shaders/count.wgsl?raw'
import scanShader from './shaders/scan.wgsl?raw'
import scatterShader from './shaders/scatter.wgsl?raw'
import writeSentinelShader from './shaders/write-sentinel.wgsl?raw'

const WORKGROUP_SIZE = 256
export type GridTimestamps = Pick<ComputePassProps, 'timestampQuerySet' | 'beginTimestampIndex' | 'endTimestampIndex'>
export const GRID_BUILD_STAGES = ['grid clear', 'grid count and scan', 'grid scatter'] as const
export type GridPassTimestamps = (stage: typeof GRID_BUILD_STAGES[number]) => GridTimestamps
export type GridBenchmark = { iterations: number; submitMilliseconds: number; totalMilliseconds: number; averageMilliseconds: number }
export type GridReadback = { counts: Uint32Array; offsets: Uint32Array; pointIndices: Uint32Array }
export type SpatialGridBackend = {
  readonly info?: string;
  readonly cellOffsets: Buffer;
  readonly pointIndices: Buffer;
  readonly pointCount: number;
  readonly gridSize: number;
  readonly cellCount: number;
  readonly scanHierarchy: number[];
  readonly positionBytes: number;
  readonly gridBytes: number;
  encodeBuild(encoder: CommandEncoder, positionIndex?: number, timestamps?: GridTimestamps, passTimestamps?: GridPassTimestamps): void;
  waitForIdle(): Promise<void>;
  build(): Promise<number>;
  benchmark(iterations: number): Promise<GridBenchmark>;
  readback(): Promise<GridReadback>;
  destroy(): void;
}
type ScanLevel = { count: number; blockCount: number; offsets: Buffer; blockSums: Buffer; parameters: Buffer; bindings: Bindings }
export function formatGridBytes (bytes: number): string {
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`
}
export function checkStorageSize (device: Device, label: string, bytes: number): void {
  for (const limit of ['maxStorageBufferBindingSize', 'maxBufferSize'] as const) {
    if (bytes > device.limits[limit]) throw new Error(`${label} needs ${bytes} bytes. ${limit} allows ${device.limits[limit]}.`)
  }
}

/** Owns the index only; the caller owns the luma device and all position buffers. */
export async function createSpatialGridResources (
  device: Device, positionBuffers: Buffer[], pointCount: number, gridSize: number
): Promise<SpatialGridBackend> {
  if (!Number.isSafeInteger(pointCount) || pointCount < 0 || !Number.isSafeInteger(gridSize) || gridSize < 1 ||
    !Number.isSafeInteger(gridSize * gridSize) || positionBuffers.length === 0) {
    throw new Error('Invalid spatial grid dimensions or position buffers')
  }
  if (positionBuffers.some(buffer => buffer.byteLength < Math.max(4, pointCount * 8) || !(buffer.usage & Buffer.STORAGE))) {
    throw new Error('Borrowed position buffers must have storage usage and space for every point')
  }
  const cellCount = gridSize * gridSize
  const positionBytes = pointCount * 8
  const pointIndexBytes = pointCount * Uint32Array.BYTES_PER_ELEMENT
  const cellBytes = cellCount * Uint32Array.BYTES_PER_ELEMENT
  const offsetBytes = (cellCount + 1) * Uint32Array.BYTES_PER_ELEMENT

  for (const buffer of positionBuffers) checkStorageSize(device, 'Position buffer', buffer.byteLength)
  checkStorageSize(device, 'Point indices', pointIndexBytes)
  checkStorageSize(device, 'Cell offsets', offsetBytes)
  const pointWorkgroups = Math.ceil(pointCount / WORKGROUP_SIZE)
  const cellWorkgroups = Math.ceil(cellCount / WORKGROUP_SIZE)
  const required = Math.max(pointWorkgroups, cellWorkgroups)
  const supported = device.limits.maxComputeWorkgroupsPerDimension
  if (required > supported) throw new Error(`Grid build needs ${required} workgroups. maxComputeWorkgroupsPerDimension allows ${supported}.`)

  const scope = resourceScope()
  const storage = (byteLength: number): Buffer => scope.own(device.createBuffer({
    byteLength: Math.max(4, byteLength), usage: Buffer.STORAGE | Buffer.COPY_SRC | Buffer.COPY_DST,
  }))
  const parameter = (values: number[]): Buffer => {
    const data = new Uint32Array(values)
    const buffer = scope.own(device.createBuffer({ byteLength: data.byteLength, usage: Buffer.UNIFORM | Buffer.COPY_DST }))
    buffer.write(data)
    return buffer
  }
  const kernel = async (source: string, bindings: Parameters<typeof bindingLayout>[0]): Promise<Kernel> =>
    scope.own(await Kernel.createAsync(device, { source, shaderLayout: { bindings: bindingLayout(bindings) } }))

  try {
    const cellCounts = storage(cellBytes); const cursors = storage(cellBytes); const pointIndices = storage(pointIndexBytes)
    const parameters = parameter([pointCount, gridSize, cellCount, 0])
    const clear = await kernel(clearShader, [['counts', 'storage']])
    const count = await kernel(countShader, [['positions', 'read-only-storage'], ['cellCounts', 'storage'], ['parameters', 'uniform']])
    const scan = await kernel(scanShader, [
      ['inputValues', 'read-only-storage'], ['outputOffsets', 'storage'], ['blockSums', 'storage'], ['parameters', 'uniform'],
    ])
    const add = await kernel(addBlockOffsetsShader, [['offsets', 'storage'], ['blockOffsets', 'read-only-storage'], ['parameters', 'uniform']])
    const sentinel = await kernel(writeSentinelShader, [['offsets', 'storage'], ['parameters', 'uniform']])
    const scatter = await kernel(scatterShader, [
      ['positions', 'read-only-storage'], ['cursors', 'storage'], ['pointIndices', 'storage'], ['parameters', 'uniform'],
    ])
    const levels: ScanLevel[] = []
    let input = cellCounts; let levelCount = cellCount
    do {
      const blockCount = Math.ceil(levelCount / WORKGROUP_SIZE)
      const offsets = storage((levelCount + (levels.length ? 0 : 1)) * 4)
      const blockSums = storage(blockCount * 4); const params = parameter([levelCount, 0, 0, 0])
      levels.push({
        count: levelCount,
        blockCount,
        offsets,
        blockSums,
        parameters: params,
        bindings: { inputValues: input, outputOffsets: offsets, blockSums, parameters: params },
      })
      input = blockSums; levelCount = blockCount
    } while (levelCount > 1)
    const cellOffsets = levels[0].offsets
    let destroyed = false
    const check = (): void => { if (destroyed || device.isLost) throw new Error('Spatial grid device unavailable') }
    const encodeBuild = (encoder: CommandEncoder, positionIndex = 0, timestamps?: GridTimestamps, passTimestamps?: GridPassTimestamps): void => {
      check(); const positions = positionBuffers[positionIndex]
      if (!positions) throw new Error('Unknown grid position buffer')
      // luma alpha has no encoder.clearBuffer; a small GPU clear keeps batched builds resident.
      // Legacy interval timestamps bracket count through scatter and exclude clearing.
      // Diagnostic pairs time each existing compute pass without changing the build schedule.
      const clearPass = encoder.beginComputePass(passTimestamps?.('grid clear'))
      clear.dispatch(clearPass, { x: Math.ceil(cellCount / WORKGROUP_SIZE), bindings: { counts: cellCounts } }); clearPass.end()
      const prepare = encoder.beginComputePass(passTimestamps?.('grid count and scan') ?? (timestamps?.beginTimestampIndex === undefined
        ? {}
        : { timestampQuerySet: timestamps.timestampQuerySet, beginTimestampIndex: timestamps.beginTimestampIndex }))
      if (pointWorkgroups) count.dispatch(prepare, { x: pointWorkgroups, bindings: { positions, cellCounts, parameters } })
      for (const level of levels) scan.dispatch(prepare, { x: level.blockCount, bindings: level.bindings })
      for (let i = levels.length - 2; i >= 0; i--) {
        add.dispatch(prepare, {
          x: Math.ceil(levels[i].count / WORKGROUP_SIZE),
          bindings: { offsets: levels[i].offsets, blockOffsets: levels[i + 1].offsets, parameters: levels[i].parameters },
        })
      }
      sentinel.dispatch(prepare, { x: 1, bindings: { offsets: cellOffsets, parameters } }); prepare.end()
      encoder.copyBufferToBuffer({ sourceBuffer: cellOffsets, destinationBuffer: cursors, size: cellBytes })
      const scatterPass = encoder.beginComputePass(passTimestamps?.('grid scatter') ?? (timestamps?.endTimestampIndex === undefined
        ? {}
        : { timestampQuerySet: timestamps.timestampQuerySet, endTimestampIndex: timestamps.endTimestampIndex }))
      if (pointWorkgroups) scatter.dispatch(scatterPass, { x: pointWorkgroups, bindings: { positions, cursors, pointIndices, parameters } })
      scatterPass.end()
    }
    const gridBytes = cellBytes * 2 + offsetBytes + pointIndexBytes + levels.reduce(
      (total, level, i) => total + level.blockCount * 4 + (i ? level.count * 4 : 0), 0)
    return {
      info: describeDevice(device),
      cellOffsets,
      pointIndices,
      encodeBuild,
      pointCount,
      gridSize,
      cellCount,
      positionBytes,
      gridBytes,
      scanHierarchy: cellCount === 1 ? [1] : [...levels.map(level => level.count), 1],
      waitForIdle: () => waitForGpu(device),
      async build (): Promise<number> {
        check()
        await waitForGpu(device)
        check()
        const start = performance.now()
        const encoder = device.createCommandEncoder()
        encodeBuild(encoder); device.submit(encoder.finish()); await waitForGpu(device)
        return performance.now() - start
      },
      async benchmark (iterations: number): Promise<GridBenchmark> {
        check()
        await waitForGpu(device)
        check()
        const start = performance.now()
        const encoder = device.createCommandEncoder()
        for (let i = 0; i < iterations; i++) encodeBuild(encoder)
        device.submit(encoder.finish()); const submitted = performance.now(); await waitForGpu(device)
        const totalMilliseconds = performance.now() - start
        return { iterations, submitMilliseconds: submitted - start, totalMilliseconds, averageMilliseconds: totalMilliseconds / iterations }
      },
      async readback (): Promise<GridReadback> {
        check()
        const read = async (buffer: Buffer, bytes: number): Promise<Uint32Array> => {
          if (!bytes) return new Uint32Array()
          const data = await buffer.readAsync(0, bytes)
          return new Uint32Array(data.buffer, data.byteOffset, bytes / 4).slice()
        }
        return {
          counts: await read(cellCounts, cellBytes),
          offsets: await read(cellOffsets, offsetBytes),
          pointIndices: await read(pointIndices, pointIndexBytes),
        }
      },
      destroy (): void {
        if (destroyed) return
        destroyed = true
        scope.destroy()
      },
    }
  } catch (error) {
    scope.destroy()
    throw error
  }
}
