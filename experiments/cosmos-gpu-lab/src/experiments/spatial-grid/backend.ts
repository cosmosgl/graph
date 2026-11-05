import { luma } from '@luma.gl/core'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'
import addBlockOffsetsShader from './shaders/add-block-offsets.wgsl?raw'
import countShader from './shaders/count.wgsl?raw'
import scanShader from './shaders/scan.wgsl?raw'
import scatterShader from './shaders/scatter.wgsl?raw'
import writeSentinelShader from './shaders/write-sentinel.wgsl?raw'

const WORKGROUP_SIZE = 256
const MAP_MODE_READ = 0x0001
const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const

export type GridBenchmark = {
  iterations: number;
  submitMilliseconds: number;
  totalMilliseconds: number;
  averageMilliseconds: number;
}

export type GridReadback = {
  counts: Uint32Array;
  offsets: Uint32Array;
  pointIndices: Uint32Array;
}

export type SpatialGridBackend = {
  readonly pointCount: number;
  readonly gridSize: number;
  readonly cellCount: number;
  readonly scanHierarchy: number[];
  readonly positionBytes: number;
  readonly gridBytes: number;
  build: () => Promise<number>;
  benchmark: (iterations: number) => Promise<GridBenchmark>;
  readback: () => Promise<GridReadback>;
  destroy: () => void;
}

type ScanLevel = {
  count: number;
  blockCount: number;
  offsets: GPUBuffer;
  blockSums: GPUBuffer;
  parameters: GPUBuffer;
  scanBindings: GPUBindGroup;
  addBindings?: GPUBindGroup;
}

function createParameterBuffer (
  device: GPUDevice,
  values: Uint32Array,
  label: string
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })
  device.queue.writeBuffer(buffer, 0, values)
  return buffer
}

function alignedStorageSize (bytes: number): number {
  return Math.max(4, Math.ceil(bytes / 4) * 4)
}

export function formatGridBytes (bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export async function createSpatialGridBackend (
  positions: Float32Array,
  gridSize: number
): Promise<SpatialGridBackend> {
  const pointCount = positions.length / 2
  const cellCount = gridSize * gridSize
  const positionBytes = positions.byteLength
  const pointIndexBytes = pointCount * Uint32Array.BYTES_PER_ELEMENT
  const cellBytes = cellCount * Uint32Array.BYTES_PER_ELEMENT
  const offsetBytes = (cellCount + 1) * Uint32Array.BYTES_PER_ELEMENT

  const lumaDevice = await luma.createDevice({
    id: `spatial-grid-${pointCount}-${gridSize}`,
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    featureLevel: 'core',
  }) as WebGPUDevice
  const device = lumaDevice.handle
  const maximumStorageBinding = Number(device.limits.maxStorageBufferBindingSize)
  const maximumBufferSize = Number(device.limits.maxBufferSize)
  const maximumDispatch = Number(device.limits.maxComputeWorkgroupsPerDimension)
  for (const [label, bytes] of [
    ['positions', positionBytes],
    ['point indices', pointIndexBytes],
    ['cell offsets', offsetBytes],
  ] as Array<[string, number]>) {
    if (bytes > maximumStorageBinding || bytes > maximumBufferSize) {
      lumaDevice.destroy()
      throw new Error(`${label} require ${formatGridBytes(bytes)}, beyond this device's buffer limit`)
    }
  }
  const pointWorkgroups = Math.ceil(pointCount / WORKGROUP_SIZE)
  if (pointWorkgroups > maximumDispatch) {
    lumaDevice.destroy()
    throw new Error(`${pointWorkgroups.toLocaleString()} workgroups exceed the dispatch limit`)
  }

  const positionBuffer = device.createBuffer({
    label: 'grid positions',
    size: alignedStorageSize(positionBytes),
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.STORAGE,
  })
  const cellCounts = device.createBuffer({
    label: 'grid cell counts',
    size: alignedStorageSize(cellBytes),
    usage: BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.STORAGE,
  })
  const cursors = device.createBuffer({
    label: 'grid scatter cursors',
    size: alignedStorageSize(cellBytes),
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.STORAGE,
  })
  const pointIndices = device.createBuffer({
    label: 'cell-grouped point indices',
    size: alignedStorageSize(pointIndexBytes),
    usage: BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.STORAGE,
  })
  const gridParameters = createParameterBuffer(
    device,
    new Uint32Array([pointCount, gridSize, cellCount, 0]),
    'spatial grid parameters'
  )
  device.queue.writeBuffer(
    positionBuffer,
    0,
    positions.buffer as ArrayBuffer,
    positions.byteOffset,
    positions.byteLength
  )

  const countPipeline = device.createComputePipeline({
    label: 'count points per cell',
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: countShader }), entryPoint: 'main' },
  })
  const scanPipeline = device.createComputePipeline({
    label: 'exclusive block scan',
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: scanShader }), entryPoint: 'main' },
  })
  const addPipeline = device.createComputePipeline({
    label: 'propagate scanned block offsets',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: addBlockOffsetsShader }),
      entryPoint: 'main',
    },
  })
  const scatterPipeline = device.createComputePipeline({
    label: 'scatter point indices by cell',
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: scatterShader }), entryPoint: 'main' },
  })
  const sentinelPipeline = device.createComputePipeline({
    label: 'write CSR sentinel',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: writeSentinelShader }),
      entryPoint: 'main',
    },
  })

  const countBindings = device.createBindGroup({
    label: 'grid count bindings',
    layout: countPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: cellCounts } },
      { binding: 2, resource: { buffer: gridParameters } },
    ],
  })

  const scanLevels: ScanLevel[] = []
  let inputBuffer = cellCounts
  let levelCount = cellCount
  while (true) {
    const blockCount = Math.ceil(levelCount / WORKGROUP_SIZE)
    const offsets = device.createBuffer({
      label: `scan level ${scanLevels.length} offsets`,
      size: alignedStorageSize(
        (levelCount + (scanLevels.length === 0 ? 1 : 0)) * Uint32Array.BYTES_PER_ELEMENT
      ),
      usage: BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.STORAGE,
    })
    const blockSums = device.createBuffer({
      label: `scan level ${scanLevels.length} block sums`,
      size: alignedStorageSize(blockCount * Uint32Array.BYTES_PER_ELEMENT),
      usage: BUFFER_USAGE.STORAGE,
    })
    const parameters = createParameterBuffer(
      device,
      new Uint32Array([levelCount, 0, 0, 0]),
      `scan level ${scanLevels.length} parameters`
    )
    const scanBindings = device.createBindGroup({
      label: `scan level ${scanLevels.length} bindings`,
      layout: scanPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: offsets } },
        { binding: 2, resource: { buffer: blockSums } },
        { binding: 3, resource: { buffer: parameters } },
      ],
    })
    scanLevels.push({ count: levelCount, blockCount, offsets, blockSums, parameters, scanBindings })
    if (blockCount === 1) break
    inputBuffer = blockSums
    levelCount = blockCount
  }

  for (let level = 0; level < scanLevels.length - 1; level += 1) {
    const current = scanLevels[level]
    current.addBindings = device.createBindGroup({
      label: `scan level ${level} propagation bindings`,
      layout: addPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: current.offsets } },
        { binding: 1, resource: { buffer: scanLevels[level + 1].offsets } },
        { binding: 2, resource: { buffer: current.parameters } },
      ],
    })
  }

  const cellOffsets = scanLevels[0].offsets
  const sentinelBindings = device.createBindGroup({
    label: 'CSR sentinel bindings',
    layout: sentinelPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cellOffsets } },
      { binding: 1, resource: { buffer: gridParameters } },
    ],
  })
  const scatterBindings = device.createBindGroup({
    label: 'grid scatter bindings',
    layout: scatterPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: cursors } },
      { binding: 2, resource: { buffer: pointIndices } },
      { binding: 3, resource: { buffer: gridParameters } },
    ],
  })

  let destroyed = false
  const encodeBuild = (encoder: GPUCommandEncoder): void => {
    encoder.clearBuffer(cellCounts)
    const preparationPass = encoder.beginComputePass({ label: 'count and scan grid' })
    preparationPass.setPipeline(countPipeline)
    preparationPass.setBindGroup(0, countBindings)
    preparationPass.dispatchWorkgroups(pointWorkgroups)
    preparationPass.setPipeline(scanPipeline)
    for (const level of scanLevels) {
      preparationPass.setBindGroup(0, level.scanBindings)
      preparationPass.dispatchWorkgroups(level.blockCount)
    }
    preparationPass.setPipeline(addPipeline)
    for (let level = scanLevels.length - 2; level >= 0; level -= 1) {
      const current = scanLevels[level]
      if (!current.addBindings) continue
      preparationPass.setBindGroup(0, current.addBindings)
      preparationPass.dispatchWorkgroups(Math.ceil(current.count / WORKGROUP_SIZE))
    }
    preparationPass.setPipeline(sentinelPipeline)
    preparationPass.setBindGroup(0, sentinelBindings)
    preparationPass.dispatchWorkgroups(1)
    preparationPass.end()

    encoder.copyBufferToBuffer(cellOffsets, 0, cursors, 0, cellBytes)
    const scatterPass = encoder.beginComputePass({ label: 'scatter points into grid cells' })
    scatterPass.setPipeline(scatterPipeline)
    scatterPass.setBindGroup(0, scatterBindings)
    scatterPass.dispatchWorkgroups(pointWorkgroups)
    scatterPass.end()
  }

  const gridBytes = cellBytes * 2 + offsetBytes + pointIndexBytes + scanLevels.reduce(
    (total, level, index) => total +
      level.blockCount * Uint32Array.BYTES_PER_ELEMENT +
      (index === 0 ? 0 : level.count * Uint32Array.BYTES_PER_ELEMENT),
    0
  )

  return {
    pointCount,
    gridSize,
    cellCount,
    scanHierarchy: scanLevels.map(level => level.count).concat(1),
    positionBytes,
    gridBytes,
    async build (): Promise<number> {
      if (destroyed) throw new Error('The spatial grid backend has been destroyed')
      const started = performance.now()
      const encoder = device.createCommandEncoder({ label: 'build spatial grid' })
      encodeBuild(encoder)
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      return performance.now() - started
    },
    async benchmark (iterations: number): Promise<GridBenchmark> {
      if (destroyed) throw new Error('The spatial grid backend has been destroyed')
      const started = performance.now()
      const encoder = device.createCommandEncoder({ label: `${iterations} spatial grid builds` })
      for (let iteration = 0; iteration < iterations; iteration += 1) encodeBuild(encoder)
      device.queue.submit([encoder.finish()])
      const submitted = performance.now()
      await device.queue.onSubmittedWorkDone()
      const totalMilliseconds = performance.now() - started
      return {
        iterations,
        submitMilliseconds: submitted - started,
        totalMilliseconds,
        averageMilliseconds: totalMilliseconds / iterations,
      }
    },
    async readback (): Promise<GridReadback> {
      if (destroyed) throw new Error('The spatial grid backend has been destroyed')
      const countsReadback = device.createBuffer({
        label: 'grid count readback',
        size: alignedStorageSize(cellBytes),
        usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
      })
      const offsetsReadback = device.createBuffer({
        label: 'grid offset readback',
        size: alignedStorageSize(offsetBytes),
        usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
      })
      const indicesReadback = device.createBuffer({
        label: 'grid index readback',
        size: alignedStorageSize(pointIndexBytes),
        usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
      })
      const encoder = device.createCommandEncoder({ label: 'read spatial grid' })
      encoder.copyBufferToBuffer(cellCounts, 0, countsReadback, 0, cellBytes)
      encoder.copyBufferToBuffer(cellOffsets, 0, offsetsReadback, 0, offsetBytes)
      encoder.copyBufferToBuffer(pointIndices, 0, indicesReadback, 0, pointIndexBytes)
      device.queue.submit([encoder.finish()])
      await Promise.all([
        countsReadback.mapAsync(MAP_MODE_READ),
        offsetsReadback.mapAsync(MAP_MODE_READ),
        indicesReadback.mapAsync(MAP_MODE_READ),
      ])
      const result = {
        counts: new Uint32Array(countsReadback.getMappedRange()).slice(),
        offsets: new Uint32Array(offsetsReadback.getMappedRange()).slice(),
        pointIndices: new Uint32Array(indicesReadback.getMappedRange()).slice(),
      }
      countsReadback.unmap()
      offsetsReadback.unmap()
      indicesReadback.unmap()
      countsReadback.destroy()
      offsetsReadback.destroy()
      indicesReadback.destroy()
      return result
    },
    destroy (): void {
      if (destroyed) return
      destroyed = true
      for (const level of scanLevels) {
        level.parameters.destroy()
        level.blockSums.destroy()
        level.offsets.destroy()
      }
      gridParameters.destroy()
      pointIndices.destroy()
      cursors.destroy()
      cellCounts.destroy()
      positionBuffer.destroy()
      lumaDevice.destroy()
    },
  }
}
