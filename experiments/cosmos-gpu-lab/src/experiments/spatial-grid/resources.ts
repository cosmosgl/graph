import { Buffer, type Device, type CommandEncoder, type Bindings, type ComputePassProps } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, upload, waitForGpu } from '../../gpu/luma'
import clearShader from './shaders/clear.wgsl?raw'
import addBlockOffsetsShader from './shaders/add-block-offsets.wgsl?raw'
import countShader from './shaders/count.wgsl?raw'
import scanShader from './shaders/scan.wgsl?raw'
import scatterShader from './shaders/scatter.wgsl?raw'
import writeSentinelShader from './shaders/write-sentinel.wgsl?raw'

const WORKGROUP_SIZE = 256
export type GridTimestamps = Pick<ComputePassProps, 'timestampQuerySet' | 'beginTimestampIndex' | 'endTimestampIndex'>
export type GridBenchmark = { iterations: number; submitMilliseconds: number; totalMilliseconds: number; averageMilliseconds: number }
export type GridReadback = { counts: Uint32Array; offsets: Uint32Array; pointIndices: Uint32Array }
export type SpatialGridBackend = {
  readonly cellOffsets: Buffer;
  readonly pointIndices: Buffer;
  readonly pointCount: number;
  readonly gridSize: number;
  readonly cellCount: number;
  readonly scanHierarchy: number[];
  readonly positionBytes: number;
  readonly gridBytes: number;
  encodeBuild(encoder: CommandEncoder, positionIndex?: number, timestamps?: GridTimestamps): void;
  build(): Promise<number>;
  benchmark(iterations: number): Promise<GridBenchmark>;
  readback(): Promise<GridReadback>;
  destroy(): void;
}
type ScanLevel = { count: number; blockCount: number; offsets: Buffer; blockSums: Buffer; parameters: Buffer; bindings: Bindings }
export function formatGridBytes (bytes: number): string {
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`
}
/** Owns the index only; the caller owns the luma device and all position buffers. */
export function createSpatialGridResources (device: Device, positionBuffers: Buffer[], pointCount: number, gridSize: number): SpatialGridBackend {
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

  const maximumStorageBinding = Number(device.limits.maxStorageBufferBindingSize)
  const maximumBufferSize = Number(device.limits.maxBufferSize)
  const maximumDispatch = Number(device.limits.maxComputeWorkgroupsPerDimension)
  for (const [label, bytes] of [
    ['positions', positionBytes],
    ['point indices', pointIndexBytes],
    ['cell offsets', offsetBytes],
  ] as Array<[string, number]>) {
    if (bytes > maximumStorageBinding || bytes > maximumBufferSize) {
      throw new Error(`${label} require ${formatGridBytes(bytes)}, beyond this device's buffer limit`)
    }
  }
  const pointWorkgroups = Math.ceil(pointCount / WORKGROUP_SIZE)
  if (pointWorkgroups > maximumDispatch) {
    throw new Error(`${pointWorkgroups.toLocaleString()} workgroups exceed the dispatch limit`)
  }
  if (Math.ceil(cellCount / WORKGROUP_SIZE) > maximumDispatch) {
    throw new Error('The grid scan exceeds the dispatch limit')
  }

  const buffers: Buffer[] = []
  const storage = (byteLength: number): Buffer => {
    const buffer = device.createBuffer({ byteLength: Math.max(4, byteLength), usage: Buffer.STORAGE | Buffer.COPY_SRC | Buffer.COPY_DST })
    buffers.push(buffer); return buffer
  }
  const parameter = (values: number[]): Buffer => {
    const buffer = upload(device, new Uint32Array(values), Buffer.UNIFORM); buffers.push(buffer); return buffer
  }
  const cellCounts = storage(cellBytes); const cursors = storage(cellBytes); const pointIndices = storage(pointIndexBytes)
  const parameters = parameter([pointCount, gridSize, cellCount, 0])
  const clear = new Kernel(device, { source: clearShader, shaderLayout: { bindings: bindingLayout([['counts', 'storage']]) } })
  const count = new Kernel(device, {
    source: countShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['positions', 'read-only-storage'], ['cellCounts', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const scan = new Kernel(device, {
    source: scanShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['inputValues', 'read-only-storage'], ['outputOffsets', 'storage'], ['blockSums', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const add = new Kernel(device, {
    source: addBlockOffsetsShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['offsets', 'storage'], ['blockOffsets', 'read-only-storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const sentinel = new Kernel(device, {
    source: writeSentinelShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['offsets', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const scatter = new Kernel(device, {
    source: scatterShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['positions', 'read-only-storage'], ['cursors', 'storage'], ['pointIndices', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
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
  const encodeBuild = (encoder: CommandEncoder, positionIndex = 0, timestamps?: GridTimestamps): void => {
    check(); const positions = positionBuffers[positionIndex]
    if (!positions) throw new Error('Unknown grid position buffer')
    // luma alpha has no encoder.clearBuffer; a small GPU clear keeps batched builds resident.
    // As in the original harness, clearing is outside the measured count/scan/scatter interval.
    const clearPass = encoder.beginComputePass()
    clear.dispatch(clearPass, { x: Math.ceil(cellCount / WORKGROUP_SIZE), bindings: { counts: cellCounts } }); clearPass.end()
    const prepare = encoder.beginComputePass(timestamps?.beginTimestampIndex === undefined
      ? {}
      : { timestampQuerySet: timestamps.timestampQuerySet, beginTimestampIndex: timestamps.beginTimestampIndex })
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
    const scatterPass = encoder.beginComputePass(timestamps?.endTimestampIndex === undefined
      ? {}
      : { timestampQuerySet: timestamps.timestampQuerySet, endTimestampIndex: timestamps.endTimestampIndex })
    if (pointWorkgroups) scatter.dispatch(scatterPass, { x: pointWorkgroups, bindings: { positions, cursors, pointIndices, parameters } })
    scatterPass.end()
  }
  const gridBytes = cellBytes * 2 + offsetBytes + pointIndexBytes + levels.reduce(
    (total, level, i) => total + level.blockCount * 4 + (i ? level.count * 4 : 0), 0)
  return {
    cellOffsets,
    pointIndices,
    encodeBuild,
    pointCount,
    gridSize,
    cellCount,
    positionBytes,
    gridBytes,
    scanHierarchy: levels.map(level => level.count).concat(1),
    async build (): Promise<number> {
      check(); const start = performance.now(); const encoder = device.createCommandEncoder()
      encodeBuild(encoder); device.submit(encoder.finish()); await waitForGpu(device)
      return performance.now() - start
    },
    async benchmark (iterations: number): Promise<GridBenchmark> {
      check(); const start = performance.now(); const encoder = device.createCommandEncoder()
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
      const [counts, offsets, indices] = await Promise.all([
        read(cellCounts, cellBytes), read(cellOffsets, offsetBytes), read(pointIndices, pointIndexBytes),
      ])
      return { counts, offsets, pointIndices: indices }
    },
    destroy (): void {
      if (destroyed) return
      destroyed = true
      for (const resource of [clear, count, scan, add, sentinel, scatter, ...buffers]) resource.destroy()
    },
  }
}
