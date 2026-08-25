import { Device, Framebuffer, luma, type Texture } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { applyConfig, createDefaultConfig, GraphConfigInterface, type GraphSimulationConfig } from '@/graph/config'
import { getMaxPointSize, readPixels, isPointAbsent } from '@/graph/helper'
import { ForceCenter } from '@/graph/modules/ForceCenter'
import { ForceCollision } from '@/graph/modules/ForceCollision'
import { ForceGravity } from '@/graph/modules/ForceGravity'
import { ForceLink, LinkDirection } from '@/graph/modules/ForceLink'
import { ForceManyBody } from '@/graph/modules/ForceManyBody'
import { ForceMouse } from '@/graph/modules/ForceMouse'
import { Clusters } from '@/graph/modules/Clusters'
import { GraphData } from '@/graph/modules/GraphData'
import { Points } from '@/graph/modules/Points'
import { Store, ALPHA_MIN } from '@/graph/modules/Store'

/**
 * A read-only view of the GPU point-position texture, for hosts (e.g. a deck.gl
 * layer) that sample positions directly instead of reading them back to the CPU.
 * See `GraphSimulation.getPointPositionTexture()`.
 */
export interface PointPositionTexture {
  /**
   * The current position texture: square RGBA32F, where point `i` lives at texel
   * `(i % textureSize, floor(i / textureSize))` as `[x, y, i, unused]` in space
   * coordinates. Owned by cosmos.gl — never write to or destroy it. The handle
   * alternates between two ping-pong textures as the simulation runs, so re-fetch
   * it whenever `version` changes rather than caching it.
   */
  texture: Texture;
  /** Number of points; texels at index `pointCount` and beyond are unused. */
  pointCount: number;
  /** Width and height of the square texture, in texels. */
  textureSize: number;
  /**
   * Monotonic counter that increases whenever the texture's identity or contents
   * change (simulation tick, drag, CPU upload, transition frame, sparse write).
   * @note An **absent** point (NaN position — see `setPointPositions`) keeps its
   * frozen last coordinate in the texture; consult the input positions to hide it.
   */
  version: number;
}

/** Options `Graph` threads into a composed simulation step. @internal */
export interface SimulationStepOptions {
  /** Run the pointer-repulsion force pass before the regular forces. */
  applyMouseRepulsion?: boolean;
  /** A host interaction (zooming with simulation-during-zoom off) suspends the forces. */
  blockedByInteraction?: boolean;
}

/**
 * The GPU force simulation, without any rendering: no canvas, no DOM, no render
 * loop, no interaction handlers. It ingests the same flat typed arrays as
 * `Graph`, runs the same force passes on `step()`, and exposes positions three
 * ways — as a live GPU texture (`getPointPositionTexture`), as asynchronous
 * snapshots (`getPointPositionsAsync`), and as synchronous reads
 * (`getPointPositions*`).
 *
 * `Graph` composes an instance of this class with its renderer and interaction
 * controllers; embedding hosts that render points themselves can use it
 * directly:
 *
 * ```ts
 * const simulation = new GraphSimulation({ spaceSize: 4096 }, devicePromise)
 * simulation.setPointPositions(positions)
 * simulation.setLinks(links)
 * simulation.applyData()
 * await simulation.ready
 * simulation.step()
 * const { texture } = simulation.getPointPositionTexture()!
 * ```
 *
 * Resource ownership follows `Graph`'s rules: an internally created device is
 * destroyed by `destroy()`; an externally supplied device is never destroyed,
 * cleared, submitted, or resized.
 */
export class GraphSimulation {
  /**
   * The full internal configuration object. When constructed by `Graph`, this is
   * `Graph`'s own config so the two stay in sync; standalone instances hold a
   * default-initialized config with the constructor's values applied.
   */
  public config: GraphConfigInterface
  /** Promise that resolves when the simulation is fully initialized and ready to use */
  public readonly ready: Promise<void>
  /** Whether the simulation has completed initialization */
  public isReady = false

  /**
   * Shared engine state (alpha, texture sizes, space size, RNG — plus the view
   * state `Graph` layers on top). @internal
   */
  public readonly store: Store
  /** The data model holding the ingested input arrays. @internal */
  public readonly data: GraphData
  /** The position/velocity engine; also carries the draw programs for `Graph`. @internal */
  public points: Points | undefined
  /** Pointer-repulsion force, run by `Graph` on right-click interactions. @internal */
  public forceMouse: ForceMouse | undefined

  private readonly deviceInitPromise: Promise<Device>
  private _device: Device | undefined
  /**
   * Tracks whether this instance owns the device and should destroy it on cleanup.
   * `true` when the simulation created its own device, `false` for an external
   * device, whose lifecycle belongs to the host.
   */
  private readonly shouldDestroyDevice: boolean
  private forceGravity: ForceGravity | undefined
  private forceCenter: ForceCenter | undefined
  private forceManyBody: ForceManyBody | undefined
  private forceLinkIncoming: ForceLink | undefined
  private forceLinkOutgoing: ForceLink | undefined
  private forceCollision: ForceCollision | undefined
  private clusters: Clusters | undefined

  private isPointPositionsUpdateNeeded = false
  private isPointSizeUpdateNeeded = false
  private isForceManyBodyUpdateNeeded = false
  private isForceLinkUpdateNeeded = false
  private isForceCenterUpdateNeeded = false
  private isPointClusterUpdateNeeded = false

  // Whether the collision force's GPU resources (grid/size textures, programs)
  // are allocated and match the current data. Allocated lazily the first time
  // collision runs, so a simulation that never enables it pays no memory cost.
  private isForceCollisionReady = false

  private _isDestroyed = false

  /**
   * Create a new simulation.
   * @param config - Optional configuration. Unset properties use default values.
   * @param devicePromise - Optional externally created luma.gl device (to share a
   *   device with a host renderer). Without it the simulation creates its own
   *   device on a detached canvas.
   * @param sharedConfigInternal - `Graph` passes its own config object here so
   *   both classes observe the same configuration. @internal
   */
  public constructor (
    config?: GraphSimulationConfig,
    devicePromise?: Promise<Device>,
    sharedConfigInternal?: GraphConfigInterface
  ) {
    if (sharedConfigInternal) {
      this.config = sharedConfigInternal
    } else {
      this.config = createDefaultConfig()
      if (config) applyConfig(this.config, config)
    }
    this.store = new Store()
    this.data = new GraphData(this.config)

    if (devicePromise) {
      this.deviceInitPromise = devicePromise
      this.shouldDestroyDevice = false // External device — the host owns it
    } else {
      const canvas = document.createElement('canvas')
      this.deviceInitPromise = this.createDevice(canvas)
      this.shouldDestroyDevice = true // Simulation created the device and owns it
    }

    const setupPromise = this.deviceInitPromise.then(device => {
      if (this._isDestroyed) {
        // Only destroy the device if this instance owns it
        if (this.shouldDestroyDevice) {
          // luma's device.destroy() leaves the canvas context's Resize/Intersection
          // observers connected — stop them explicitly or they outlive the simulation.
          device.canvasContext?.destroy()
          device.destroy()
        }
        return device
      }
      this._device = device

      this.store.adjustSpaceSize(this.config.spaceSize, device.limits.maxTextureDimension2D)
      this.store.setWebGLMaxTextureSize(device.limits.maxTextureDimension2D)
      this.store.maxPointSize = getMaxPointSize(device, this.config.pixelRatio)

      // Initialize simulation state based on enableSimulation config
      // If simulation is disabled, start with isSimulationRunning = false
      this.store.isSimulationRunning = this.config.enableSimulation

      this.points = new Points(device, this.config, this.store, this.data)
      if (this.config.enableSimulation) this.ensureSimulationModules()
      this.clusters = new Clusters(device, this.config, this.store, this.data, this.points)

      if (this.config.randomSeed !== undefined) this.store.addRandomSeed(this.config.randomSeed)

      this.isReady = true
      return device
    })
      .catch(error => {
        this._device = undefined
        this.isReady = false
        console.error('Device initialization failed:', error)
        throw error
      })

    this.ready = setupPromise.then(() => undefined)
  }

  /** The luma.gl device the simulation runs on. @internal */
  public get device (): Device | undefined {
    return this._device
  }

  /** Whether `destroy()` will destroy the device (it was created internally). @internal */
  public get ownsDevice (): boolean {
    return this.shouldDestroyDevice
  }

  /**
   * Returns the current simulation progress
   */
  public get progress (): number {
    if (this._isDestroyed) return 0
    return this.store.simulationProgress
  }

  /**
   * A value that gives information about the running simulation status.
   */
  public get isSimulationRunning (): boolean {
    if (this._isDestroyed) return false
    return this.store.isSimulationRunning
  }

  /**
   * Partially updates the simulation configuration. Only the provided properties
   * change; all other properties retain their current values.
   *
   * @note Instances composed by a `Graph` are configured through
   * `Graph.setConfig` instead — the two share one configuration object.
   */
  public setConfig (config: GraphSimulationConfig): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setConfig(config))) return
    const prevConfig = { ...this.config }
    applyConfig(this.config, config, true)
    this.applyEnableSimulationConfigChange(prevConfig)
    if (prevConfig.pointDefaultSize !== this.config.pointDefaultSize) {
      this.data.updatePointSize()
      this.points?.updateSize()
    }
    // The collision grid's cell size is derived from the collision radius and
    // padding; in derived-radius mode the radius comes from point sizes.
    if (prevConfig.simulationCollisionRadius !== this.config.simulationCollisionRadius ||
        prevConfig.simulationCollisionPadding !== this.config.simulationCollisionPadding ||
        ((this.config.simulationCollisionRadius === undefined || this.config.simulationCollisionRadius === 0) &&
         prevConfig.pointDefaultSize !== this.config.pointDefaultSize)) {
      this.isForceCollisionReady = false
    }
    if (prevConfig.spaceSize !== this.config.spaceSize) {
      this.store.adjustSpaceSize(this.config.spaceSize, this._device?.limits.maxTextureDimension2D ?? 4096)
      // Collision grid dimensions depend on adjustedSpaceSize
      this.isForceCollisionReady = false
      this.update(this.store.isSimulationRunning ? this.store.alpha : 0)
    }
  }

  /**
   * Sets the positions for the simulation points — flat `[x0, y0, x1, y1, …]`,
   * as in `Graph.setPointPositions` (see it for the NaN-absence contract).
   * Takes effect on the next `applyData()`.
   */
  public setPointPositions (pointPositions: Float32Array, dontRescale?: boolean | undefined): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointPositions(pointPositions, dontRescale))) return
    this.data.inputPointPositions = pointPositions
    if (this.points) this.points.shouldSkipRescale = dontRescale
    this.isPointPositionsUpdateNeeded = true
    // Point sizes and every per-point force resource depend on the point count
    this.isPointSizeUpdateNeeded = true
    this.isPointClusterUpdateNeeded = true
    this.isForceManyBodyUpdateNeeded = true
    this.isForceLinkUpdateNeeded = true
    this.isForceCenterUpdateNeeded = true
  }

  /**
   * Sets the sizes for the simulation points — the collision force derives point
   * radii from sizes when `simulationCollisionRadius` is unset.
   * Takes effect on the next `applyData()`.
   */
  public setPointSizes (pointSizes: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointSizes(pointSizes))) return
    this.data.inputPointSizes = pointSizes
    this.isPointSizeUpdateNeeded = true
  }

  /**
   * Sets the links — flat `[source0, target0, source1, target1, …]` of point
   * indices, as in `Graph.setLinks`. Takes effect on the next `applyData()`.
   */
  public setLinks (links: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinks(links))) return
    this.data.inputLinks = links
    this.isForceLinkUpdateNeeded = true
  }

  /** Sets per-link spring strength coefficients, as in `Graph.setLinkStrength`. */
  public setLinkStrength (linkStrength: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinkStrength(linkStrength))) return
    this.data.inputLinkStrength = linkStrength
    this.isForceLinkUpdateNeeded = true
  }

  /** Sets the cluster index for each point, as in `Graph.setPointClusters`. */
  public setPointClusters (pointClusters: (number | undefined)[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointClusters(pointClusters))) return
    this.data.inputPointClusters = pointClusters
    this.isPointClusterUpdateNeeded = true
  }

  /** Sets fixed cluster positions, as in `Graph.setClusterPositions`. */
  public setClusterPositions (clusterPositions: (number | undefined)[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setClusterPositions(clusterPositions))) return
    this.data.inputClusterPositions = clusterPositions
    this.isPointClusterUpdateNeeded = true
  }

  /** Sets per-point cluster force coefficients, as in `Graph.setPointClusterStrength`. */
  public setPointClusterStrength (clusterStrength: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointClusterStrength(clusterStrength))) return
    this.data.inputClusterStrength = clusterStrength
    this.isPointClusterUpdateNeeded = true
  }

  /**
   * Sets which points are pinned (fixed) in position. See `Graph.setPinnedPoints`.
   * @param pinnedIndices - Point indices to pin; `[]` or `null` unpins all points.
   */
  public setPinnedPoints (pinnedIndices: number[] | null): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPinnedPoints(pinnedIndices))) return
    this.data.inputPinnedPoints = pinnedIndices && pinnedIndices.length > 0 ? pinnedIndices : undefined
    this.points?.updatePinnedStatus()
  }

  /**
   * Pins or unpins a single point with a one-texel GPU write — no full rebuild.
   * See `Graph.setPointPinned`.
   */
  public setPointPinned (index: number, pinned: boolean): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointPinned(index, pinned))) return
    if (!Number.isInteger(index) || index < 0) return

    // Keep the CPU-side pinned set in sync so a later full rebuild
    // (`updatePinnedStatus` on data changes) agrees with the texel write.
    // Clone instead of mutating: the current array may belong to the caller.
    const pinnedSet = new Set(this.data.inputPinnedPoints)
    if (pinned) pinnedSet.add(index)
    else pinnedSet.delete(index)
    this.data.inputPinnedPoints = pinnedSet.size > 0 ? [...pinnedSet] : undefined

    this.points?.setPointPinnedStatus(index, pinned)
  }

  /**
   * Moves a single point with a one-texel GPU write into the live simulation
   * state. See `Graph.setPointPosition` for the full contract.
   */
  public setPointPosition (index: number, x: number, y: number): void {
    this.setPointPositionsByIndices([index], [x, y])
  }

  /**
   * Batched form of `setPointPosition`. See `Graph.setPointPositionsByIndices`.
   */
  public setPointPositionsByIndices (indices: number[], positions: number[] | Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointPositionsByIndices(indices, positions))) return
    if (indices.length * 2 !== positions.length) {
      console.warn(`setPointPositionsByIndices: expected ${indices.length * 2} coordinates ` +
        `for ${indices.length} indices, got ${positions.length}. Call ignored.`)
      return
    }
    if (!this.points) return
    this.points.setPointPositionsByIndices(indices, positions)
    // trackPoints() must run after every write to the current position texture
    this.points.trackPoints()
  }

  /**
   * Applies pending data changes (positions, links, sizes, clusters, pinning)
   * to the GPU. The standalone counterpart of `Graph.render()`: call it after
   * the `set*` methods, before stepping.
   *
   * @param simulationAlpha - Optional alpha value to set:
   *   positive reheats, `0` freezes, `undefined` keeps the current alpha.
   */
  public applyData (simulationAlpha?: number): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.applyData(simulationAlpha))) return
    this.data.update()
    this.update(simulationAlpha)
  }

  /**
   * Start or reheat the simulation with the given alpha. Fires
   * `onSimulationStart` when the simulation was not already running.
   * @param alpha Value from 0 to 1. The higher the value, the more initial energy the simulation will get.
   */
  public start (alpha = 1): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.start(alpha))) return
    if (!this.config.enableSimulation) return
    if (!this.data.pointsNumber) return
    const wasRunning = this.store.isSimulationRunning
    this.store.isSimulationRunning = true
    this.store.simulationProgress = 0
    this.store.alpha = alpha
    if (!wasRunning) this.config.onSimulationStart?.()
  }

  /**
   * Stop the simulation and reset its state. Use `start()` to begin a new cycle.
   */
  public stop (): void {
    if (this._isDestroyed) return
    const wasSimulationActive = this.store.isSimulationRunning || this.store.alpha > 0 || this.store.simulationProgress > 0
    this.store.isSimulationRunning = false
    this.store.simulationProgress = 0
    this.store.alpha = 0
    if (wasSimulationActive) this.config.onSimulationEnd?.()
  }

  /**
   * Pause the simulation, preserving its state (progress, alpha).
   * Resume with `unpause()`.
   */
  public pause (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.pause())) return
    if (!this.store.isSimulationRunning) return
    this.store.isSimulationRunning = false
    this.config.onSimulationPause?.()
  }

  /**
   * Resume a paused simulation.
   */
  public unpause (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.unpause())) return
    if (!this.config.enableSimulation) return
    if (this.store.isSimulationRunning) return
    this.store.isSimulationRunning = true
    this.config.onSimulationUnpause?.()
  }

  /**
   * Run one simulation step. Works even when the simulation is paused.
   * When the alpha decays below the floor, ends the simulation and fires
   * `onSimulationEnd` — a standalone simulation has no render loop to do it.
   */
  public step (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.step())) return
    if (!this.config.enableSimulation) return
    if (!this.store.pointsTextureSize) return

    this.runSimulationStep(true)
    if (this.store.alpha < ALPHA_MIN && this.store.isSimulationRunning) {
      this.end()
    }
  }

  /**
   * Get current X and Y coordinates of the points. Synchronous GPU read —
   * see `Graph.getPointPositions` for the full contract and the async variant.
   */
  public getPointPositions (): number[] {
    return Array.from(this.getPointPositionsArray())
  }

  /**
   * Get current point positions as a `Float32Array` in `[x0, y0, x1, y1, …]`
   * order. See `Graph.getPointPositionsArray`.
   * @param out - Optional destination array, reused when large enough.
   */
  public getPointPositionsArray (out?: Float32Array): Float32Array {
    if (this._isDestroyed || !this._device || !this.points) return new Float32Array(0)
    if (this.data.pointsNumber === undefined || !this.points.currentPositionFbo) return new Float32Array(0)
    const pointPositionsPixels = readPixels(this._device, this.points.currentPositionFbo as Framebuffer)
    return this.composePointPositions(pointPositionsPixels, out)
  }

  /**
   * Asynchronous variant of `getPointPositionsArray()`: the pixel copy runs on
   * the GPU timeline and the promise resolves when it completes — no CPU stall.
   * @param out - Optional destination array, as in `getPointPositionsArray()`.
   */
  public async getPointPositionsAsync (out?: Float32Array): Promise<Float32Array> {
    if (this._isDestroyed || !this._device || !this.points) return new Float32Array(0)
    if (this.data.pointsNumber === undefined) return new Float32Array(0)
    const pointPositionsPixels = await this.points.readPositionPixelsAsync()
    if (!pointPositionsPixels || this._isDestroyed) return new Float32Array(0)
    return this.composePointPositions(pointPositionsPixels, out)
  }

  /**
   * Get a read-only view of the GPU position texture. See `PointPositionTexture`
   * for the texel layout and the ping-pong/version contract.
   * @returns The texture view, or `undefined` before the first `applyData()` call.
   */
  public getPointPositionTexture (): PointPositionTexture | undefined {
    if (this._isDestroyed || !this.points) return undefined
    const texture = this.points.currentPositionTexture
    if (!texture || texture.destroyed || !this.store.pointsTextureSize) return undefined
    return {
      texture,
      pointCount: this.data.pointsNumber ?? 0,
      textureSize: this.store.pointsTextureSize,
      version: this.points.positionVersion,
    }
  }

  /**
   * Get current X and Y coordinates of the clusters.
   * @returns Array of cluster positions in `[x0, y0, x1, y1, ...]` order. Do not mutate the returned array.
   */
  public getClusterPositions (): Readonly<number[]> {
    if (this._isDestroyed || !this._device || !this.clusters) return []
    if (this.data.pointClusters === undefined || this.clusters.clusterCount === undefined) return []
    return this.clusters.getCentroidPositions()
  }

  /**
   * Destroy the simulation and release its GPU resources. An externally
   * supplied device is left untouched.
   */
  public destroy (): void {
    if (this._isDestroyed) return
    this._isDestroyed = true
    this.isReady = false

    this.points?.destroy()
    this.clusters?.destroy()
    this.destroySimulationModules()
    this.forceMouse?.destroy()
    this.forceMouse = undefined

    if (this._device && this.shouldDestroyDevice) {
      // Clears the canvas after the particle system is destroyed
      const clearPass = this._device.beginRenderPass({
        clearColor: this.store.backgroundColor,
        clearDepth: 1,
        clearStencil: 0,
      })
      clearPass.end()
      this._device.submit()
      // luma's device.destroy() leaves the canvas context's Resize/Intersection
      // observers connected — stop them explicitly or they outlive the simulation.
      this._device.canvasContext?.destroy()
      this._device.destroy()
    }
  }

  /**
   * Recomputes the data-texture sizes from the current point/link counts.
   * @internal
   */
  public updateTextureSizes (): void {
    this.store.pointsTextureSize = Math.ceil(Math.sqrt(this.data.pointsNumber ?? 0))
    this.store.linksTextureSize = Math.ceil(Math.sqrt((this.data.linksNumber ?? 0) * 2))
  }

  /**
   * Uploads every pending simulation-side data change to the GPU: positions,
   * sizes, and the per-force resources. The rendering channels (colors, shapes,
   * link buffers, …) are `Graph`'s side of `create()`.
   * @returns Whether point positions were re-uploaded — position-derived render
   * resources (the link index buffer) must be invalidated when they were.
   * @internal
   */
  public applyDataUpdates (): { positionsUpdated: boolean } {
    const positionsUpdated = this.isPointPositionsUpdateNeeded
    if (!this.points) return { positionsUpdated: false }

    if (this.isPointPositionsUpdateNeeded) this.points.updatePositions()
    if (this.isPointSizeUpdateNeeded) this.points.updateSize()

    if (this.isForceManyBodyUpdateNeeded) this.forceManyBody?.create()
    // Collision grid/size textures depend on point count and sizes. Mark them
    // stale so they're rebuilt lazily the next time the collision force runs,
    // rather than reallocating here while collision may be disabled.
    if (this.isForceManyBodyUpdateNeeded || this.isPointSizeUpdateNeeded) this.isForceCollisionReady = false
    if (this.isForceLinkUpdateNeeded) {
      this.forceLinkIncoming?.create(LinkDirection.INCOMING)
      this.forceLinkOutgoing?.create(LinkDirection.OUTGOING)
    }
    if (this.isForceCenterUpdateNeeded) this.forceCenter?.create()
    if (this.isPointClusterUpdateNeeded) this.clusters?.create()

    this.isPointPositionsUpdateNeeded = false
    this.isPointSizeUpdateNeeded = false
    this.isForceManyBodyUpdateNeeded = false
    this.isForceLinkUpdateNeeded = false
    this.isForceCenterUpdateNeeded = false
    this.isPointClusterUpdateNeeded = false

    return { positionsUpdated }
  }

  /**
   * (Re)initializes the simulation-side GPU programs (points, forces, clusters).
   * @internal
   */
  public initPrograms (): void {
    if (this._isDestroyed || !this.points || !this.clusters) return
    this.points.initPrograms()
    this.forceGravity?.initPrograms()
    this.forceManyBody?.initPrograms()
    this.forceCenter?.initPrograms()
    this.forceLinkIncoming?.initPrograms()
    this.forceLinkOutgoing?.initPrograms()
    this.forceMouse?.initPrograms()
    // ForceCollision programs are built lazily on first use (see runSimulationStep)
    this.clusters.initPrograms()
  }

  /**
   * Runs one step of the simulation (forces, position updates, alpha decay).
   *
   * @param forceExecution - If `true`, runs even while the simulation is paused
   *   (the `step()` semantics); if `false`, respects `isSimulationRunning`.
   * @param options - Interaction context a composing `Graph` threads in.
   * @returns Whether the force passes ran — the caller invalidates
   *   position-derived state (picking buffers) when they did.
   * @internal
   */
  public runSimulationStep (forceExecution = false, options?: SimulationStepOptions): boolean {
    const { config: { simulationGravity, simulationCenter, simulationCollision, enableSimulation }, store: { isSimulationRunning } } = this

    if (!enableSimulation) return false

    this.resetExternalDeviceState()

    // Pointer repulsion (runs regardless of isSimulationRunning)
    if (options?.applyMouseRepulsion) {
      this.points?.swapFbo()
      this.forceMouse?.run()
      this.points?.updatePosition()
    }

    // Main simulation forces gate:
    // If forceExecution is true (from step()), always run.
    // Otherwise, respect isSimulationRunning and the host's interaction state.
    const shouldRunSimulation = forceExecution ||
      (isSimulationRunning && !options?.blockedByInteraction)

    // Swap-before-write: every GPU position write is preceded by swapFbo(). The swap makes
    // `previous` point to the freshest data so updatePosition() reads it
    // and writes the new result into `current`. After each swap+write pair
    // `current` holds the latest positions — the draw pass, hover detection,
    // trackPoints and the next frame all read from `current`.
    if (shouldRunSimulation) {
      if (simulationGravity) {
        this.points?.swapFbo()
        this.forceGravity?.run()
        this.points?.updatePosition()
      }

      if (simulationCenter) {
        this.points?.swapFbo()
        this.forceCenter?.run()
        this.points?.updatePosition()
      }

      this.points?.swapFbo()
      this.forceManyBody?.run()
      this.points?.updatePosition()

      if (this.store.linksTextureSize) {
        this.points?.swapFbo()
        this.forceLinkIncoming?.run()
        this.points?.updatePosition()
        this.points?.swapFbo()
        this.forceLinkOutgoing?.run()
        this.points?.updatePosition()
      }

      if (this.data.pointClusters || this.data.clusterPositions) {
        this.points?.swapFbo()
        this.clusters?.run()
        this.points?.updatePosition()
      }

      // Collision runs after the attraction forces (links, clusters) so it
      // corrects the overlap they introduce within the same tick, instead of
      // lagging one frame behind and oscillating against them.
      if (simulationCollision) {
        // Lazily allocate the collision GPU resources on first use (or after a
        // data change marked them stale), so a simulation that never enables
        // collision never pays the grid/size-texture memory cost.
        if (!this.isForceCollisionReady) {
          this.forceCollision?.create()
          this.forceCollision?.initPrograms()
          this.isForceCollisionReady = true
        }
        this.points?.swapFbo()
        this.forceCollision?.run()
        this.points?.updatePosition()
      }

      // Alpha decay and progress
      this.store.alpha += this.store.addAlpha(this.config.simulationDecay)
      if (options?.applyMouseRepulsion) {
        this.store.alpha = Math.max(this.store.alpha, 0.1)
      }
      this.store.simulationProgress = Math.sqrt(Math.min(1, ALPHA_MIN / this.store.alpha))

      this.config.onSimulationTick?.(
        this.store.alpha,
        this.store.hoveredPoint?.index,
        this.store.hoveredPoint?.position
      )
    }

    // Track points (runs regardless of simulation state)
    this.points?.trackPoints()

    return shouldRunSimulation
  }

  /**
   * Ends the simulation: stops it, sets progress to 1, and fires
   * `onSimulationEnd`. Called when the alpha decays below the floor.
   * @internal
   */
  public end (): void {
    this.store.isSimulationRunning = false
    this.store.simulationProgress = 1
    this.config.onSimulationEnd?.()
  }

  /**
   * Restores the ambient GL state the simulation's offscreen passes assume,
   * before any GPU work on an **externally supplied** device.
   *
   * luma applies only the pipeline `parameters` a Model declares; everything
   * else (blend, depth, scissor, …) is inherited from the context's current
   * state. An internally created device keeps the WebGL defaults, but an
   * external device arrives mid-frame carrying the host's state — deck.gl, for
   * example, leaves blending enabled, and blended writes into the RGBA32F
   * position textures (whose texels carry alpha 0) zero out the whole
   * simulation.
   * @internal
   */
  public resetExternalDeviceState (): void {
    if (this.shouldDestroyDevice) return // own device: no host code touches its state
    const device = this._device as (Device & { setParametersWebGL?: (parameters: Record<string, unknown>) => void }) | undefined
    device?.setParametersWebGL?.({
      blend: false,
      depthTest: false,
      depthMask: true,
      scissorTest: false,
      stencilTest: false,
      cull: false,
      colorMask: [true, true, true, true],
    })
  }

  /**
   * (Re)creates the force modules after `enableSimulation` turns on.
   * @internal
   */
  public ensureSimulationModules (): void {
    if (!this._device || !this.points) return

    this.forceGravity ||= new ForceGravity(this._device, this.config, this.store, this.data, this.points)
    this.forceCenter ||= new ForceCenter(this._device, this.config, this.store, this.data, this.points)
    this.forceManyBody ||= new ForceManyBody(this._device, this.config, this.store, this.data, this.points)
    this.forceLinkIncoming ||= new ForceLink(this._device, this.config, this.store, this.data, this.points)
    this.forceLinkOutgoing ||= new ForceLink(this._device, this.config, this.store, this.data, this.points)
    this.forceMouse ||= new ForceMouse(this._device, this.config, this.store, this.data, this.points)
    this.forceCollision ||= new ForceCollision(this._device, this.config, this.store, this.data, this.points)
  }

  /**
   * Destroys the force modules and the points' simulation-only resources after
   * `enableSimulation` turns off.
   * @internal
   */
  public destroySimulationModules (): void {
    this.forceGravity?.destroy()
    this.forceGravity = undefined
    this.forceCenter?.destroy()
    this.forceCenter = undefined
    this.forceManyBody?.destroy()
    this.forceManyBody = undefined
    this.forceLinkIncoming?.destroy()
    this.forceLinkIncoming = undefined
    this.forceLinkOutgoing?.destroy()
    this.forceLinkOutgoing = undefined
    this.forceMouse?.destroy()
    this.forceMouse = undefined
    this.forceCollision?.destroy()
    this.forceCollision = undefined
    // Force lazy re-allocation if collision is re-enabled on a new instance.
    this.isForceCollisionReady = false
    this.points?.destroySimulationResources()
  }

  /** Marks every per-force GPU resource for a rebuild on the next data apply. @internal */
  public markForcesDirty (): void {
    this.isForceManyBodyUpdateNeeded = true
    this.isForceLinkUpdateNeeded = true
    this.isForceCenterUpdateNeeded = true
  }

  /** Invalidates the lazily built collision-force resources. @internal */
  public invalidateCollisionResources (): void {
    this.isForceCollisionReady = false
  }

  /**
   * Applies `enableSimulation` lifecycle changes for standalone instances.
   * (`Graph` orchestrates its own version, interleaving transition teardown
   * and render-side rebuilds.)
   */
  private applyEnableSimulationConfigChange (prevConfig: GraphConfigInterface): void {
    if (prevConfig.enableSimulation === this.config.enableSimulation) return

    if (this.config.enableSimulation) {
      this.ensureSimulationModules()
      this.points?.ensureSimulationResources()
      this.markForcesDirty()
      // Rebuild simulation resources before binding programs to them.
      this.applyDataUpdates()
      this.initPrograms()
      this.store.simulationProgress = 0
      this.store.alpha = 1
      this.store.isSimulationRunning = true
      this.config.onSimulationStart?.()
      return
    }

    const wasSimulationActive = this.store.isSimulationRunning || this.store.alpha > 0 || this.store.simulationProgress > 0
    this.store.isSimulationRunning = false
    this.store.alpha = 0
    this.store.simulationProgress = 0
    if (wasSimulationActive) this.config.onSimulationEnd?.()
    this.destroySimulationModules()
  }

  /**
   * Uploads pending data and re-initializes programs.
   * @param simulationAlpha - Optional alpha value to set. If not provided, keeps current alpha.
   */
  private update (simulationAlpha = this.store.alpha): void {
    this.updateTextureSizes()
    this.applyDataUpdates()
    this.initPrograms()
    this.store.alpha = simulationAlpha
  }

  /**
   * Ensures device is initialized before executing a method.
   * If device is not ready, queues the method to run after initialization.
   * @param callback - Function to execute once device is ready
   * @returns true if device was not ready and operation was queued, false if device is ready
   */
  private ensureDevice (callback: () => void): boolean {
    if (!this.isReady) {
      this.ready
        .then(() => {
          if (this._isDestroyed) return
          callback()
        })
        .catch(error => {
          console.error('Device initialization failed', error)
        })
      return true
    }
    return false
  }

  /**
   * Internal device creation method: a WebGL 2 device on a detached canvas —
   * the simulation never renders to the screen.
   */
  private async createDevice (canvas: HTMLCanvasElement): Promise<Device> {
    return await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: {
        canvas, // Provide existing canvas
        useDevicePixels: this.config.pixelRatio, // Use config pixelRatio value
        autoResize: true,
        width: undefined,
        height: undefined,
      },
    })
  }

  /**
   * Maps raw RGBA position texels (`[x, y, index, unused]` per point) to the
   * public `[x, y]` pair layout, resolving absent points to NaN: the texture keeps
   * a removed point's frozen last coordinate (the exit fade renders from it), which
   * must not read back as a live position.
   */
  private composePointPositions (pixels: Float32Array, out?: Float32Array): Float32Array {
    const pointsNumber = this.data.pointsNumber ?? 0
    const positions = out && out.length >= pointsNumber * 2 ? out : new Float32Array(pointsNumber * 2)
    for (let i = 0; i < pointsNumber; i += 1) {
      if (this.data.pointPositions && isPointAbsent(this.data.pointPositions, i)) {
        positions[i * 2] = NaN
        positions[i * 2 + 1] = NaN
        continue
      }
      positions[i * 2] = pixels[i * 4 + 0] as number
      positions[i * 2 + 1] = pixels[i * 4 + 1] as number
    }
    return positions
  }
}
