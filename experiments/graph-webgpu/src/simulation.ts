import { Buffer, luma, type Device } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { applyConfig, createDefaultConfig, validateConfig, type GraphConfigInterface, type GraphSimulationConfig } from '../../../src/config'
import type { PositionsReadOptions } from '../../../src/simulation'
import { isPointAbsent } from '../../../src/helper'
import { GraphData } from '../../../src/modules/GraphData'
import { ALPHA_MIN, Store } from '../../../src/modules/Store'
import { PointTrackerImpl, type PointTracker } from './modules/Points/point-tracker'
import { assertStorageSize, upload, workgroupGrid } from './modules/Shared/compute'
import { positionScales, unpackPositions, writePosition } from './simulation-data'
import { asFloats, createPrograms, createState, type Programs, type SimulationState } from './simulation-kernels'

/** Borrowed storage on the simulation device: four float32s per slot, [worldX, worldY, pinned, absent].
 * An absent slot may keep its last finite XY during a visual exit. Use its absence flag for membership.
 * A tick or edit changes the version and can replace the buffer. Do not destroy or write it. */
export interface PointPositionBuffer {
  device: Device;
  buffer: Buffer;
  count: number;
  pointCount: number;
  version: number;
}

// GraphData resolves channels by replacing references. Keep the pending input
// references available for a corrected retry while restoring the displayed model.
function resolveData (data: GraphData, update: () => void, validate?: () => void): void {
  if (!validate) { update(); return }
  const previous = { ...data }
  try { update(); validate() } catch (error) {
    Object.assign(data, previous)
    throw error
  }
}

// Keep the four-float position ABI for up to ten million points on capable devices.
const showcasePositionBytes = 10_000_000 * 4 * Float32Array.BYTES_PER_ELEMENT

async function createGraphDevice (canvas?: HTMLCanvasElement): Promise<Device> {
  const create = (maxStorageBufferBindingSize?: number): Promise<Device> => luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    requiredLimits: maxStorageBufferBindingSize === undefined ? undefined : { maxStorageBufferBindingSize },
    waitForPageLoad: false,
    createCanvasContext: canvas ? { canvas, autoResize: false, useDevicePixels: false, alphaMode: 'premultiplied' } : undefined,
  })
  try {
    return await create(showcasePositionBytes)
  } catch (error) {
    // A failed limit request consumes the GPUAdapter. Let luma select a fresh one
    // with core limits; keep adapter, canvas, loss and other creation failures visible.
    if (!(error instanceof Error) || error.message !== 'WebGPU device request failed') throw error
    const cause = error.cause
    if (!(cause instanceof DOMException) || cause.name !== 'OperationError') throw error
    if (!/max[_ ]?storage[_ ]?buffer[_ ]?binding[_ ]?size/i.test(cause.message)) {
      // Some browsers return only a generic OperationError. Confirm the limit
      // on the current default adapter before attributing the rejection to size.
      type Limits = Pick<Device['limits'], 'maxStorageBufferBindingSize'>
      const { gpu } = navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ limits: Limits } | null> } }
      const adapter = await gpu?.requestAdapter()
      if (!adapter || adapter.limits.maxStorageBufferBindingSize >= showcasePositionBytes) throw error
    }
    return create()
  }
}

// An external device can outlive many graphs. Remove their callbacks on dispose.
const lossListeners = new WeakMap<Device, Set<() => void>>()
function watchLoss (device: Device, listener: () => void): () => void {
  let listeners = lossListeners.get(device)
  if (!listeners) {
    const active = new Set<() => void>()
    device.lost.then(() => {
      for (const notify of active) notify()
      active.clear()
    })
    lossListeners.set(device, active)
    listeners = active
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

interface SimulationHost {
  onDeviceLost(): void;
  onPositionEdit(index: number, record: Float32Array): void;
  onDataApplied?(pointListChanged: boolean): void;
}

enum DataUpload {
  Positions = 1,
  Samples = 2,
  Topology = 4,
  Sizes = 8,
  Clusters = 16,
  Attractors = 32,
}

export class GraphSimulation {
  public readonly config: GraphConfigInterface
  public readonly data: GraphData
  public readonly store = new Store()
  public readonly ready: Promise<void>
  public device?: Device
  public isReady = false
  public scaleX?: (value: number) => number
  public scaleY?: (value: number) => number
  private readonly shouldDestroyDevice: boolean
  private isDestroyed = false
  private forgetLoss?: () => void
  private programs?: Programs
  private state?: SimulationState
  private readonly trackers = new Set<PointTrackerImpl>()
  /** Applied membership, including when a caller mutates and resubmits the same input array. */
  private absentSlots?: Uint8Array
  private countGeneration = 0
  private version = 0
  // render()/applyData() resolves the setter inputs before consuming these channels.
  private pendingUpdates = 0
  // create() can upload the previous model once without spending an unresolved setter.
  private pendingCreates = 0
  private centroidPositions: readonly number[] = []
  private isCentroidReadPending = false
  private centroidVersion = -1
  private centroidGeneration = 0
  private shouldSkipRescale = false
  private pinned = new Set<number>()
  private beforeReady: Array<() => void> = []

  public constructor (
    config?: GraphSimulationConfig, devicePromise?: Promise<Device>, sharedConfig?: GraphConfigInterface,
    canvas?: HTMLCanvasElement, private host?: SimulationHost
  ) {
    this.config = sharedConfig ?? createDefaultConfig()
    if (config) applyConfig(this.config, config, true)
    this.data = new GraphData(this.config)
    // Points use instanced quads. Shared Zoom radius queries must use their full drawn size.
    this.store.maxPointSize = Infinity
    this.store.adjustSpaceSize(this.config.spaceSize)
    if (this.config.randomSeed !== undefined) this.store.addRandomSeed(this.config.randomSeed)
    this.store.isSimulationRunning = this.config.enableSimulation
    this.shouldDestroyDevice = !devicePromise
    this.ready = (devicePromise ?? createGraphDevice(canvas)).then(device => {
      if (device.type !== 'webgpu') throw new Error('Cosmos requires a WebGPU device.')
      this.device = device
      if (this.isDestroyed) { this.releaseDevice(); return }
      if (device.isLost) throw new Error('Cannot initialize Cosmos on a lost WebGPU device.')
      this.programs = createPrograms(device)
      this.isReady = true
      this.forgetLoss = watchLoss(device, () => {
        const host = this.host
        this.destroy()
        host?.onDeviceLost()
      })
      const pending = this.beforeReady
      this.beforeReady = []
      for (const operation of pending) operation()
    }).catch(error => {
      this.destroy()
      throw error
    })
  }

  public get ownsDevice (): boolean { return this.shouldDestroyDevice }
  public get progress (): number { return this.isDestroyed ? 0 : this.store.simulationProgress }
  public get isSimulationRunning (): boolean { return this.isReady && this.store.isSimulationRunning }

  /** @internal A pure topology replacement can keep the renderer's point records. */
  public get hasOnlyLinkTopologyUpdate (): boolean {
    return this.pendingUpdates === DataUpload.Topology
  }

  public setConfig (config: GraphSimulationConfig): void {
    if (this.isDestroyed) return
    validateConfig(config)
    if (this.defer(() => this.setConfig(config))) return
    const previous = { ...this.config }
    applyConfig(this.config, config, true)
    this.applyConfigChanges(previous)
    // A host can edit the simulation directly. Its next Graph.render() must also refresh the drawn size and image fallback.
    if (previous.pointDefaultSize !== this.config.pointDefaultSize) this.host?.onDataApplied?.(false)
  }

  /** Synchronize a partial standalone update or a Graph update of the shared config. */
  public applyConfigChanges (previous: GraphConfigInterface): void {
    const spaceChanged = previous.spaceSize !== this.config.spaceSize
    const enabling = !previous.enableSimulation && this.config.enableSimulation
    if (spaceChanged) this.store.adjustSpaceSize(this.config.spaceSize)
    if (previous.simulationRepulsionSamples !== this.config.simulationRepulsionSamples) this.state?.restartOccupancyMeasurement()
    if (previous.enableSimulation && !this.config.enableSimulation) {
      this.stop()
      this.state?.releaseForces()
    }
    if (enabling) {
      this.queueUpload(DataUpload.Samples | DataUpload.Topology | DataUpload.Attractors | DataUpload.Sizes)
      this.applyData(1)
      this.store.simulationProgress = 0
      this.store.isSimulationRunning = true
      this.config.onSimulationStart?.()
    } else if (spaceChanged) {
      this.applyData(this.store.isSimulationRunning ? this.store.alpha : 0)
    }
    if (previous.pointDefaultSize !== this.config.pointDefaultSize) {
      this.data.updatePointSize()
      if (this.config.enableSimulation) this.state?.updateSizes(this.data)
    }
  }

  public setPointPositions (xy: Float32Array, dontRescale = false): void {
    if (this.defer(() => this.setPointPositions(xy, dontRescale))) return
    this.data.inputPointPositions = xy
    this.shouldSkipRescale = dontRescale
    this.queueUpload(DataUpload.Positions | DataUpload.Samples | DataUpload.Topology | DataUpload.Sizes)
  }

  public setLinks (links: Float32Array): void {
    if (this.defer(() => this.setLinks(links))) return
    this.data.inputLinks = links
    this.queueUpload(DataUpload.Topology)
  }

  public setLinkStrength (weights: Float32Array): void {
    if (this.defer(() => this.setLinkStrength(weights))) return
    this.data.inputLinkStrength = weights
    this.queueUpload(DataUpload.Topology)
  }

  public setPointSizes (sizes: Float32Array): void {
    if (this.defer(() => this.setPointSizes(sizes))) return
    this.data.inputPointSizes = sizes
    this.queueUpload(DataUpload.Sizes)
  }

  public setPointClusters (groups: (number | undefined)[]): void {
    if (this.defer(() => this.setPointClusters(groups))) return
    this.data.inputPointClusters = groups
    this.queueUpload(DataUpload.Clusters)
  }

  public setClusterPositions (targets: (number | undefined)[]): void {
    if (this.defer(() => this.setClusterPositions(targets))) return
    this.data.inputClusterPositions = targets
    this.queueUpload(DataUpload.Clusters)
  }

  public setPointClusterStrength (strength: Float32Array): void {
    if (this.defer(() => this.setPointClusterStrength(strength))) return
    this.data.inputClusterStrength = strength
    this.queueUpload(DataUpload.Clusters)
  }

  public setPointAttractors (targets: Float32Array): void {
    if (this.defer(() => this.setPointAttractors(targets))) return
    this.data.inputPointAttractors = targets
    this.queueUpload(DataUpload.Attractors)
  }

  public setPointAttractorStrength (strength: Float32Array): void {
    if (this.defer(() => this.setPointAttractorStrength(strength))) return
    this.data.inputPointAttractorStrength = strength
    this.queueUpload(DataUpload.Attractors)
  }

  public setPinnedPoints (indices: number[] | null): void {
    if (this.defer(() => this.setPinnedPoints(indices))) return
    const previous = this.pinned
    this.pinned = new Set((indices ?? []).filter(i => Number.isInteger(i) && i >= 0))
    this.data.inputPinnedPoints = [...this.pinned]
    for (const i of previous) if (!this.pinned.has(i)) this.writePin(i, false)
    for (const i of this.pinned) if (!previous.has(i)) this.writePin(i, true)
  }

  public setPinnedPoint (index: number, pinned: boolean): void {
    if (this.defer(() => this.setPinnedPoint(index, pinned)) || !Number.isInteger(index) || index < 0 || this.pinned.has(index) === pinned) return
    if (pinned) this.pinned.add(index)
    else this.pinned.delete(index)
    this.data.inputPinnedPoints = [...this.pinned]
    this.writePin(index, pinned)
  }

  public isPointPinned (index: number): boolean { return !this.isDestroyed && this.pinned.has(index) }

  public setPointPosition (index: number, x: number, y: number): void { this.setPointPositionsByIndices([index], [x, y]) }

  public setPointPositionsByIndices (indices: number[], positions: Float32Array | number[]): void {
    if (this.defer(() => this.setPointPositionsByIndices(indices, positions)) || indices.length * 2 !== positions.length) return
    if (!this.state) return
    const packed = new Float32Array(4)
    for (const [i, id] of indices.entries()) {
      if (!Number.isInteger(id) || id < 0 || id >= this.state.count) continue
      if (this.data.pointPositions && isPointAbsent(this.data.pointPositions, id)) continue
      const x = Math.fround(positions[2 * i]!)
      const y = Math.fround(positions[2 * i + 1]!)
      if (Number.isNaN(x) || Number.isNaN(y)) continue
      writePosition(packed, 0, x, y, this.pinned.has(id), this.store.infiniteInputEdge)
      for (const pos of this.state.positions) pos.write(packed, 16 * id)
      this.host?.onPositionEdit(id, packed)
      this.version++
    }
  }

  /** @internal Apply point paint and footprints without walking link data. A direct simulation setter can still require a full update. */
  public applyPointStyleUpdate (colors: boolean, sizes: boolean, alpha?: number, validate?: () => void): boolean {
    if (this.pendingUpdates && !(sizes && this.pendingUpdates === DataUpload.Sizes)) return false
    resolveData(this.data, () => {
      if (colors) this.data.updatePointColor()
      if (sizes) {
        this.data.updatePointSize()
        this.data.updatePointImageSizes()
      }
    }, validate)
    if (sizes) {
      if (this.config.enableSimulation) this.state?.updateSizes(this.data)
      this.pendingUpdates &= ~DataUpload.Sizes
      this.pendingCreates &= ~DataUpload.Sizes
    }
    if (alpha !== undefined) this.store.alpha = alpha
    return true
  }

  /** @internal A width edit affects drawing only. Any simulation setter queued alongside it still needs a full data update. */
  public applyLinkWidthUpdate (alpha?: number): boolean {
    if (this.pendingUpdates) return false
    this.data.updateLinkWidth()
    if (alpha !== undefined) this.store.alpha = alpha
    return true
  }

  public applyData (alpha?: number): void {
    this.applyValidatedData(alpha)
  }

  /** @internal A Graph sharing this model validates a compact style before the GPU channels become visible. */
  public applyValidatedData (alpha?: number, validate?: () => void): void {
    if (this.defer(() => this.applyValidatedData(alpha, validate))) return
    // Reject an unsupported replacement before GraphData resolves its parallel
    // channels. Keep the displayed model and GPU positions together on failure.
    const nextCount = Math.floor((this.data.inputPointPositions?.length ?? 0) / 2)
    assertStorageSize(this.device!, nextCount * 16, 'Point position buffer')
    resolveData(this.data, () => this.data.update(), validate)
    this.uploadChannels(this.pendingUpdates)
    this.pendingUpdates = this.pendingCreates = 0
    this.shouldSkipRescale = false
    if (alpha !== undefined) this.store.alpha = alpha
  }

  /** @internal Upload channels requested by setters from the already processed model. */
  public uploadResolvedData (): void {
    if (!this.isReady || !this.pendingCreates) return
    this.uploadChannels(this.pendingCreates)
    // When create() ran after a setter, render() must still apply its unresolved
    // input. An already uploaded position array must not rewind later GPU motion.
    if ((this.pendingCreates & DataUpload.Positions) && this.data.pointPositions === this.data.inputPointPositions) {
      this.pendingUpdates &= ~DataUpload.Positions
    }
    this.pendingCreates = 0
  }

  public getPointPositionBuffer (): PointPositionBuffer | undefined {
    if (!this.isReady || !this.state || !this.device || this.device.isLost) return undefined
    const { count } = this.state
    return { device: this.device, buffer: this.state.current(), count, pointCount: count, version: this.version }
  }

  /**
   * Follow point indices independently of other consumers. May be called before data or device initialization.
   * Await `positionsAsync()` for a fresh GPU snapshot. Synchronous reads use the last completed snapshot.
   */
  public trackPoints (indices: readonly number[]): PointTracker {
    const tracker = new PointTrackerImpl(indices, this, () => { this.trackers.delete(tracker) })
    if (this.isDestroyed) tracker.destroy()
    else this.trackers.add(tracker)
    return tracker
  }

  public async getPointPositionsAsync (out?: Float32Array): Promise<Float32Array> {
    const source = this.getPointPositionBuffer()
    if (!source) return new Float32Array()
    const generation = this.countGeneration
    const bytes = await this.readWhileLive(source.buffer.readAsync())
    if (!bytes) return new Float32Array()
    const packed = asFloats(bytes)
    return this.isReady && generation === this.countGeneration ? unpackPositions(packed, out) : new Float32Array()
  }

  public async getPointPositionsByIndicesAsync (indices: readonly number[]): Promise<Float32Array> {
    const source = this.getPointPositionBuffer()
    if (!source || !indices.length) return new Float32Array()
    const generation = this.countGeneration
    assertStorageSize(source.device, indices.length * 16, 'Gathered position buffer')
    const groups = workgroupGrid(Math.ceil(indices.length / 64), source.device.limits.maxComputeWorkgroupsPerDimension)
    const ids = upload(source.device, Uint32Array.from(indices, i => Number.isInteger(i) && i >= 0 && i < source.count ? i : 0xffffffff))
    let output: Buffer | undefined
    try {
      output = source.device.createBuffer({ byteLength: indices.length * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })
      const encoder = source.device.createCommandEncoder()
      try {
        const pass = encoder.beginComputePass({})
        try {
          this.programs!.gather.dispatch(pass, { ...groups, bindings: { positions: source.buffer, ids, output } })
        } finally { pass.end() }
        source.device.submit(encoder.finish())
      } finally { encoder.destroy() }
      const bytes = await this.readWhileLive(output.readAsync())
      if (!bytes) return new Float32Array()
      const packed = asFloats(bytes)
      return this.isReady && generation === this.countGeneration ? unpackPositions(packed) : new Float32Array()
    } finally { output?.destroy(); ids.destroy() }
  }

  /** Internal notification after a Graph position-transition dispatch writes the live GPU buffer. */
  public markPositionsChanged (): void { this.version++ }

  /** Latest completed centroid sample in XY order; the first call schedules a copy.
   * WebGPU always reads without blocking. Await getClusterPositionsAsync() for this invocation's coordinates.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getClusterPositions (_options?: PositionsReadOptions): readonly number[] {
    if (!this.isReady || !this.state || !this.data.pointClusters) return []
    if (this.version !== this.centroidVersion && !this.isCentroidReadPending) {
      this.isCentroidReadPending = true
      this.getClusterPositionsAsync().catch(error => {
        if (this.isReady && !this.device?.isLost) console.error(error)
      }).finally(() => { this.isCentroidReadPending = false })
    }
    return this.centroidPositions
  }

  /** Read the centroids of the clusters applied when the call was submitted. */
  public async getClusterPositionsAsync (): Promise<number[]> {
    const state = this.state
    if (!this.isReady || !state) return []
    const generation = this.centroidGeneration
    const version = this.version
    try {
      const result = await this.readWhileLive(state.readClusters())
      if (generation !== this.centroidGeneration || !result) return []
      if (version >= this.centroidVersion) {
        this.centroidVersion = version
        this.centroidPositions = result.slice()
      }
      return result
    } catch (error) {
      // Replacing membership may release the old aggregate during readback.
      if (generation !== this.centroidGeneration) return []
      throw error
    }
  }

  public applyMouseRepulsion (worldX: number, worldY: number): void {
    if (!this.isReady || !this.state || !this.config.enableSimulation || !this.config.simulationRepulsionFromMouse) return
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return
    this.state.applyPointer(this.config, worldX, worldY)
    if (this.store.isSimulationRunning) this.store.alpha = Math.max(this.store.alpha, 0.1)
    this.version++
  }

  public async getBoundsAsync (): Promise<[number, number, number, number] | undefined> {
    const state = this.state
    if (!this.isReady || !state) return undefined
    const b = await this.readWhileLive(state.readBounds())
    if (!b || state !== this.state || b[0]! > b[2]!) return undefined
    return [b[0]!, b[1]!, b[2]!, b[3]!]
  }

  public start (alpha = 1): void {
    if (this.defer(() => this.start(alpha)) || !this.config.enableSimulation || !this.state) return
    const wasRunning = this.store.isSimulationRunning
    this.store.isSimulationRunning = true
    this.store.simulationProgress = 0
    this.store.alpha = alpha
    if (!wasRunning) this.config.onSimulationStart?.()
  }

  public pause (): void {
    if (this.defer(() => this.pause()) || !this.store.isSimulationRunning) return
    this.store.isSimulationRunning = false
    this.config.onSimulationPause?.()
  }

  public unpause (): void {
    if (this.defer(() => this.unpause()) || !this.config.enableSimulation || this.store.isSimulationRunning) return
    this.store.isSimulationRunning = true
    this.config.onSimulationUnpause?.()
  }

  public stop (): void {
    if (this.defer(() => this.stop())) return
    const active = this.store.isSimulationRunning || this.store.alpha > 0 || this.store.simulationProgress > 0
    this.store.isSimulationRunning = false
    this.store.simulationProgress = 0
    this.store.alpha = 0
    if (active) this.config.onSimulationEnd?.()
  }

  public end (): void {
    if (this.defer(() => this.end())) return
    this.store.isSimulationRunning = false
    this.store.simulationProgress = 1
    this.config.onSimulationEnd?.()
  }

  public runSimulationStep (forceExecution = false, pointer?: readonly [number, number], blocked = false, measureOccupancy = false): boolean {
    if (!this.isReady || !this.state || !this.config.enableSimulation) return false
    // As in WebGL, a held right button applies its kick before the ordinary
    // forces, even when the graph is paused or the camera blocks layout.
    if (pointer && this.config.simulationRepulsionFromMouse) {
      this.state.applyPointer(this.config, ...pointer)
      this.version++
    }
    if (!forceExecution && (!this.store.isSimulationRunning || blocked)) return false
    this.state.step(this.config, measureOccupancy)
    this.version++
    this.store.alpha += this.store.addAlpha(this.config.simulationDecay)
    if (pointer) this.store.alpha = Math.max(0.1, this.store.alpha)
    this.store.simulationProgress = Math.sqrt(Math.min(1, ALPHA_MIN / this.store.alpha))
    this.config.onSimulationTick?.(this.store.alpha, this.store.hoveredPoint?.index, this.store.hoveredPoint?.position)
    if (this.store.isSimulationRunning && this.store.alpha < ALPHA_MIN) this.end()
    return true
  }

  public step (): void {
    if (this.defer(() => this.step())) return
    this.runSimulationStep(true)
  }

  public destroy (): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.forgetLoss?.()
    this.forgetLoss = undefined
    this.host = undefined
    this.isReady = false
    this.beforeReady = []
    this.invalidateCentroids()
    for (const tracker of this.trackers) tracker.destroy()
    this.absentSlots = undefined
    this.scaleX = this.scaleY = undefined
    this.state?.destroy()
    this.state = undefined
    this.programs?.destroy()
    this.programs = undefined
    this.store.isSimulationRunning = false
    this.releaseDevice()
  }

  private queueUpload (channels: DataUpload): void {
    if (channels & (DataUpload.Positions | DataUpload.Clusters)) this.invalidateCentroids()
    this.pendingUpdates |= channels
    this.pendingCreates |= channels
  }

  private uploadChannels (channels: number): void {
    let next = this.state
    const count = this.data.targetPointsNumber
    const resize = count !== (next?.count ?? 0)
    const reset = !!(channels & DataUpload.Positions) || resize
    let absent: Uint8Array | undefined
    try {
      if (reset) {
        assertStorageSize(this.device!, count * 16, 'Point position buffer')
        const xy = this.data.pointPositions ?? new Float32Array()
        const rescale = !this.shouldSkipRescale && (this.config.rescalePositions ?? !this.config.enableSimulation)
        const scales = rescale ? positionScales(xy, this.store) : {}
        if (!this.shouldSkipRescale) { this.scaleX = scales.x; this.scaleY = scales.y }
        const packed = new Float32Array(count * 4)
        for (let i = 0; i < count; i++) {
          const x = xy[i * 2]!; const y = xy[i * 2 + 1]!
          writePosition(packed, i * 4, scales.x ? scales.x(x) : x, scales.y ? scales.y(y) : y,
            this.pinned.has(i), this.store.infiniteInputEdge)
          if (packed[4 * i + 3]) {
            absent ??= new Uint8Array(Math.ceil(count / 8))
            absent[i >>> 3]! |= 1 << (i & 7)
          }
        }
        if (resize) next = count ? createState(this.device!, packed, this.store, this.programs!) : undefined
        else if (next) for (const pos of next.positions) pos.write(packed)
      }
      if (this.config.enableSimulation) {
        if (resize || (channels & DataUpload.Samples)) next?.updateSamples()
        if (resize || (channels & DataUpload.Topology)) next?.updateTopology(this.data)
        if (resize || (channels & DataUpload.Attractors)) next?.updateAttractors(this.data)
        if (resize || (channels & DataUpload.Sizes)) next?.updateSizes(this.data)
      }
      if (resize || (channels & DataUpload.Clusters)) next?.updateClusters(this.data)
    } catch (error) {
      if (next !== this.state) next?.destroy()
      throw error
    }
    if (resize) { this.state?.destroy(); this.state = next; this.countGeneration++ }
    let pointListChanged = false
    if (reset) {
      const previous = this.absentSlots
      this.absentSlots = absent
      pointListChanged = resize || previous?.length !== absent?.length || !!absent?.some((byte, i) => byte !== previous?.[i])
      if (pointListChanged) {
        const present = (id: number): boolean => id < count && !((absent?.[id >>> 3] ?? 0) & (1 << (id & 7)))
        for (const tracker of this.trackers) tracker.pointListChanged(present)
      }
    }
    if (reset || (channels & DataUpload.Clusters)) {
      this.version++
      this.invalidateCentroids()
    }
    this.host?.onDataApplied?.(pointListChanged)
  }

  private invalidateCentroids (): void {
    this.centroidGeneration++
    this.centroidPositions = []
    this.centroidVersion = -1
  }

  // Preserve invocation order across mixed setters, uploads, sparse writes and ticks before ready.
  private defer (operation: () => void): boolean {
    if (this.isDestroyed || this.device?.isLost) return true
    if (this.isReady) return false
    this.beforeReady.push(operation)
    return true
  }

  private async readWhileLive<T> (pending: Promise<T>): Promise<T | undefined> {
    try {
      const value = await pending
      return this.isReady && !this.device?.isLost ? value : undefined
    } catch (error) {
      if (this.isDestroyed || this.device?.isLost) return undefined
      throw error
    }
  }

  private writePin (i: number, pinned: boolean): void {
    if (!this.state || i >= this.state.count) return
    const value = new Float32Array([Number(pinned)])
    for (const pos of this.state.positions) pos.write(value, 16 * i + 8)
    this.version++
  }

  private releaseDevice (): void {
    if (this.ownsDevice) this.device?.destroy()
    this.device = undefined
  }
}
