import { Buffer, luma, type Device } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { applyConfig, createDefaultConfig, validateConfig, type GraphConfigInterface, type GraphSimulationConfig } from '../../../src/config'
import { isPointAbsent } from '../../../src/helper'
import { GraphData } from '../../../src/modules/GraphData'
import { ALPHA_MIN, Store } from '../../../src/modules/Store'
import { upload } from './modules/Shared/compute'
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
  onDataApplied?(): void;
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
  private countGeneration = 0
  private version = 0
  private isPositionsDirty = false
  private shouldRefreshSamples = false
  private isTopologyDirty = false
  private isSizesDirty = false
  private isClustersDirty = false
  private isAttractorsDirty = false
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
    this.store.adjustSpaceSize(this.config.spaceSize)
    if (this.config.randomSeed !== undefined) this.store.addRandomSeed(this.config.randomSeed)
    this.store.isSimulationRunning = this.config.enableSimulation
    this.shouldDestroyDevice = !devicePromise
    this.ready = (devicePromise ?? luma.createDevice({
      type: 'webgpu',
      adapters: [webgpuAdapter],
      waitForPageLoad: false,
      createCanvasContext: canvas ? { canvas, autoResize: false, useDevicePixels: false, alphaMode: 'premultiplied' } : undefined,
    })).then(device => {
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
  public get progress (): number { return this.store.simulationProgress }
  public get isSimulationRunning (): boolean { return this.isReady && this.store.isSimulationRunning }

  public setConfig (config: GraphSimulationConfig): void {
    if (this.isDestroyed) return
    validateConfig(config)
    if (this.defer(() => this.setConfig(config))) return
    const previous = { ...this.config }
    applyConfig(this.config, config, true)
    this.applyConfigChanges(previous)
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
      this.shouldRefreshSamples = this.isTopologyDirty = this.isAttractorsDirty = this.isSizesDirty = true
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
    this.isPositionsDirty = true
    this.shouldRefreshSamples = this.isTopologyDirty = this.isSizesDirty = true
  }

  public setLinks (links: Float32Array): void {
    if (this.defer(() => this.setLinks(links))) return
    this.data.inputLinks = links
    this.isTopologyDirty = true
  }

  public setLinkStrength (weights: Float32Array): void {
    if (this.defer(() => this.setLinkStrength(weights))) return
    this.data.inputLinkStrength = weights
    this.isTopologyDirty = true
  }

  public setPointSizes (sizes: Float32Array): void {
    if (this.defer(() => this.setPointSizes(sizes))) return
    this.data.inputPointSizes = sizes
    this.isSizesDirty = true
  }

  public setPointClusters (groups: (number | undefined)[]): void {
    if (this.defer(() => this.setPointClusters(groups))) return
    this.data.inputPointClusters = groups
    this.isClustersDirty = true
  }

  public setClusterPositions (targets: (number | undefined)[]): void {
    if (this.defer(() => this.setClusterPositions(targets))) return
    this.data.inputClusterPositions = targets
    this.isClustersDirty = true
  }

  public setPointClusterStrength (strength: Float32Array): void {
    if (this.defer(() => this.setPointClusterStrength(strength))) return
    this.data.inputClusterStrength = strength
    this.isClustersDirty = true
  }

  public setPointAttractors (targets: Float32Array): void {
    if (this.defer(() => this.setPointAttractors(targets))) return
    this.data.inputPointAttractors = targets
    this.isAttractorsDirty = true
  }

  public setPointAttractorStrength (strength: Float32Array): void {
    if (this.defer(() => this.setPointAttractorStrength(strength))) return
    this.data.inputPointAttractorStrength = strength
    this.isAttractorsDirty = true
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

  /** @internal A width edit affects drawing only. Any simulation setter queued alongside it still needs a full data update. */
  public applyLinkWidthUpdate (alpha?: number): boolean {
    if (this.isPositionsDirty || this.isSizesDirty || this.isTopologyDirty || this.isClustersDirty ||
      this.isAttractorsDirty || this.shouldRefreshSamples) return false
    this.data.updateLinkWidth()
    if (alpha !== undefined) this.store.alpha = alpha
    return true
  }

  public applyData (alpha?: number): void {
    if (this.defer(() => this.applyData(alpha))) return
    this.data.update()
    let next = this.state
    const count = this.data.targetPointsNumber
    const resize = count !== (next?.count ?? 0)
    const reset = this.isPositionsDirty || resize
    try {
      if (reset) {
        const xy = this.data.pointPositions ?? new Float32Array()
        const rescale = !this.shouldSkipRescale && (this.config.rescalePositions ?? !this.config.enableSimulation)
        const scales = rescale ? positionScales(xy, this.store) : {}
        if (!this.shouldSkipRescale) { this.scaleX = scales.x; this.scaleY = scales.y }
        const packed = new Float32Array(count * 4)
        for (let i = 0; i < count; i++) {
          const x = xy[i * 2]!; const y = xy[i * 2 + 1]!
          writePosition(packed, i * 4, scales.x ? scales.x(x) : x, scales.y ? scales.y(y) : y,
            this.pinned.has(i), this.store.infiniteInputEdge)
        }
        if (resize) next = count ? createState(this.device!, packed, this.store, this.programs!) : undefined
        else if (next) for (const pos of next.positions) pos.write(packed)
      }
      if (this.config.enableSimulation) {
        if (resize || this.shouldRefreshSamples) next?.updateSamples()
        if (resize || this.isTopologyDirty) next?.updateTopology(this.data)
        if (resize || this.isAttractorsDirty) next?.updateAttractors(this.data)
        if (resize || this.isSizesDirty) next?.updateSizes(this.data)
      }
      if (resize || this.isClustersDirty) next?.updateClusters(this.data)
    } catch (error) {
      if (next !== this.state) next?.destroy()
      throw error
    }
    if (resize) { this.state?.destroy(); this.state = next; this.countGeneration++ }
    if (reset || this.isClustersDirty) this.version++
    this.isPositionsDirty = this.shouldRefreshSamples = this.isTopologyDirty = this.isSizesDirty = false
    this.isClustersDirty = this.isAttractorsDirty = false
    this.shouldSkipRescale = false
    if (alpha !== undefined) this.store.alpha = alpha
    this.host?.onDataApplied?.()
  }

  public getPointPositionBuffer (): PointPositionBuffer | undefined {
    if (!this.isReady || !this.state || !this.device || this.device.isLost) return undefined
    const { count } = this.state
    return { device: this.device, buffer: this.state.current(), count, pointCount: count, version: this.version }
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
    const ids = upload(source.device, Uint32Array.from(indices, i => Number.isInteger(i) && i >= 0 && i < source.count ? i : 0xffffffff))
    let output: Buffer | undefined
    try {
      output = source.device.createBuffer({ byteLength: indices.length * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })
      const encoder = source.device.createCommandEncoder()
      try {
        const pass = encoder.beginComputePass({})
        try {
          this.programs!.gather.dispatch(pass, { x: Math.ceil(indices.length / 64), bindings: { positions: source.buffer, ids, output } })
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

  public async getClusterPositionsAsync (): Promise<number[]> {
    const state = this.state
    if (!this.isReady || !state) return []
    const result = await this.readWhileLive(state.readClusters())
    return state === this.state && result ? result : []
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
    this.state?.destroy()
    this.state = undefined
    this.programs?.destroy()
    this.programs = undefined
    this.store.isSimulationRunning = false
    this.releaseDevice()
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
