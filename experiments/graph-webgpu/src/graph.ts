import type { Device, RenderPass } from '@luma.gl/core'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoomIdentity, type ZoomTransform } from 'd3-zoom'
import { applyConfig, createDefaultConfig, resetConfigToDefaults, validateConfig, type GraphConfig } from '@/graph/config'
import { Zoom } from '@/graph/modules/Zoom'
import { Drag } from '@/graph/modules/Drag'
import { Transition, TransitionProperty } from '@/graph/modules/Transition'
import type { GraphData } from '@/graph/modules/GraphData'
import { sanitizeHtml } from '@/graph/helper'
import type { PositionsReadOptions } from '@/graph/simulation'
import { defaultConfigValues } from '@/graph/variables'
import { GraphSimulation, type PointPositionBuffer } from './simulation'
import { GraphRenderer, type GraphDrawOptions, type GraphView } from './renderer'
import { bindPressPicking } from './press-picking'
import { AreaSelection, type Area, type Pair } from './modules/Points/area-selection'
import type { PointTracker } from './modules/Points/point-tracker'
import { PositionTransition, copyPositions } from './position-transition'
import { LabelSampling } from './label-sampling'

type PointerHit = { point?: number; link?: number; position?: Pair }

export class Graph {
  public readonly config = createDefaultConfig()
  public readonly simulation: GraphSimulation
  public readonly graph: GraphData
  public readonly ready: Promise<void>
  public isReady = false
  private readonly camera: Zoom
  private readonly transition = new Transition(this.config)
  private readonly drag: Drag
  private readonly listeners = new AbortController()
  private readonly pending: Array<() => void> = []
  private canvas?: HTMLCanvasElement
  private attribution?: HTMLDivElement
  private observer?: ResizeObserver
  private renderer?: GraphRenderer
  private area?: AreaSelection
  private labels?: LabelSampling
  private clusterPositions: readonly number[] = []
  private clusterRead?: Promise<void>
  private clusterVersion = -1
  private tracker?: PointTracker
  private mouseRepulsion?: Pair
  private positionTransition?: PositionTransition
  private frame = 0
  private isAutomaticFrame = false
  private containerSize?: Pair
  private isFrameInFlight = false
  private isDestroyed = false
  private shouldUpdateAllStyles = false
  private hasRendered = false
  private fitTimer?: ReturnType<typeof setTimeout>
  private fitRequest = 0
  private revision = 0
  private hoverRequest = 0
  private hasHoverSceneChanged = false
  private refreshHoverAfterDraw?: (sceneChanged: boolean) => void
  private hoveredPoint?: number
  private hoveredLink?: number
  private dragged?: { index: number; pinned: boolean; offset: Pair }

  public constructor (private readonly container: HTMLDivElement | null | undefined, config?: GraphConfig, devicePromise?: Promise<Device>) {
    if (config) applyConfig(this.config, config)
    const canvas = container && !devicePromise ? document.createElement('canvas') : undefined
    this.simulation = new GraphSimulation(undefined, devicePromise, this.config, canvas, {
      onDeviceLost: (): void => this.destroy(),
      onPositionEdit: (id, record): void => this.positionTransition?.edit(id, record),
      onDataApplied: (pointListChanged): void => {
        this.shouldUpdateAllStyles = true
        // The public simulation can apply data directly, before Graph.render().
        this.area?.invalidateFootprints()
        if (pointListChanged) this.revision++
      },
    })
    this.graph = this.simulation.data
    this.camera = new Zoom(this.simulation.store, this.config)
    this.drag = new Drag(this.simulation.store, this.config, this.transition)
    this.ready = this.simulation.ready.then(() => {
      if (this.isDestroyed) return
      const device = this.simulation.device!
      this.renderer = new GraphRenderer(device, this.graph, this.config, () => this.simulation.getPointPositionBuffer(), {
        ownsCanvas: this.simulation.ownsDevice, trackSizes: !!container,
      })
      if (container) {
        const attached = device.canvasContext?.canvas
        if (!(attached instanceof HTMLCanvasElement)) throw new Error('An interactive WebGPU Graph requires an HTML canvas on its device')
        this.canvas = attached
        attached.style.display = 'block'
        attached.style.width = '100%'
        attached.style.height = '100%'
        if (attached.parentElement !== container) container.appendChild(attached)
        this.resize()
        this.bindInput(attached)
        this.observer = new ResizeObserver(() => this.resize())
        this.observer.observe(container)
        this.updateAttribution()
      }
      this.isReady = true
      if (this.config.initialZoomLevel !== undefined) this.setZoomLevel(this.config.initialZoomLevel)
      for (const operation of this.pending.splice(0)) operation()
    }).catch(error => {
      this.destroy()
      throw error
    })
  }

  public get isSimulationRunning (): boolean { return this.simulation.isSimulationRunning }
  public get progress (): number { return this.simulation.progress }
  public get maxPointSize (): number { return this.simulation.store.maxPointSize }

  public render (alpha?: number, transitionDuration?: number): void {
    this.whenReady(() => {
      this.transition.setDurationOverride(this.canvas && this.hasRendered ? transitionDuration : 0)
      const animate = this.transition.duration > 0 && this.transition.isPending
      const newPositions = this.transition.isPendingFor(TransitionProperty.Positions)
      const pointColors = this.transition.isPendingFor(TransitionProperty.PointColors)
      const pointSizes = this.transition.isPendingFor(TransitionProperty.PointSizes)
      const linkWidths = this.transition.isPendingFor(TransitionProperty.LinkWidths)
      const oldSource = this.getPointPositionBuffer()
      if (!newPositions && this.transition.isPending && this.transition.isActiveFor(TransitionProperty.Positions) && oldSource) {
        if (this.positionTransition?.write(oldSource, 1)) this.simulation.markPositionsChanged()
      }
      const from = animate && newPositions && oldSource ? copyPositions(oldSource) : undefined
      const partial = this.hasRendered && !this.shouldUpdateAllStyles
      let pointStylesOnly = false
      let linkWidthsOnly = false
      try {
        if (partial && (pointColors || pointSizes) && !linkWidths) {
          pointStylesOnly = this.simulation.applyPointStyleUpdate(pointColors, pointSizes, alpha)
        } else if (partial && linkWidths && !pointColors && !pointSizes) {
          linkWidthsOnly = this.simulation.applyLinkWidthUpdate(alpha)
        }
        if (!pointStylesOnly && !linkWidthsOnly) this.simulation.applyData(alpha)
        this.renderer?.update({
          pointChannels: pointStylesOnly ? { colors: pointColors, sizes: pointSizes } : undefined,
          linkWidthsOnly,
          animate,
          previousProgress: this.transition.progress,
          animatePointSizes: pointSizes,
          animateLinkWidths: linkWidths,
          continueTransition: this.transition.isActive && !this.transition.isPending,
        })
        const target = this.getPointPositionBuffer()
        if (from && target) {
          this.positionTransition ??= new PositionTransition(target.device)
          this.positionTransition.begin(from, target)
          this.simulation.pause()
        } else {
          from?.destroy()
          if (newPositions) this.positionTransition?.clear()
        }
      } catch (error) {
        from?.destroy()
        throw error
      }
      this.shouldUpdateAllStyles = false
      this.transition.start()
      if (!linkWidthsOnly && !pointStylesOnly) {
        this.labels?.invalidate()
        this.clusterVersion = -1
      }
      // Full data updates already invalidated the footprints through the simulation host.
      if (pointStylesOnly && pointSizes) this.area?.invalidateFootprints()
      const isFirst = !this.hasRendered && !!this.graph.pointsNumber
      this.hasRendered = !!this.graph.pointsNumber
      this.hasHoverSceneChanged = true
      this.hoverRequest++
      if (!this.hasRendered) this.clearHover()
      this.drawFrame()
      if (isFirst && this.canvas && this.config.fitViewOnInit && this.config.initialZoomLevel === undefined) {
        this.fitTimer = setTimeout(() => {
          if (this.config.fitViewByPointIndices) this.fitViewByPointIndices(this.config.fitViewByPointIndices, this.config.fitViewDuration, this.config.fitViewPadding)
          else if (this.config.fitViewByPointsInRect) this.fitViewByPointPositions(this.config.fitViewByPointsInRect.flat(), this.config.fitViewDuration, this.config.fitViewPadding)
          else this.fitView(this.config.fitViewDuration, this.config.fitViewPadding)
        }, this.config.fitViewDelay)
      }
      this.requestFrame()
    })
  }

  public renderOneFrame (): void {
    if (!this.isReady) { this.whenReady(() => this.renderOneFrame()); return }
    if (!this.canvas || this.isDestroyed) return
    if (!this.isAutomaticFrame) {
      // ResizeObserver can run after the caller’s animation callback. Draw the
      // new backing size immediately and consume any already scheduled idle paint.
      this.resize()
      if (this.frame && !this.isSimulationRunning && !this.transition.isActive && !this.mouseRepulsion) {
        cancelAnimationFrame(this.frame)
        this.frame = 0
      }
    }
    this.runSimulationStep(false, this.isAutomaticFrame && this.simulation.ownsDevice)
    this.drawFrame()
  }

  /** Record into the host's open pass using the viewport supplied to setViewTransform(). */
  public drawToRenderPass (pass: RenderPass, options?: GraphDrawOptions): void {
    if (!this.hasRendered || this.isDestroyed) return
    const view = this.view(options?.pixelRatio)
    if (view.width > 0 && view.height > 0) this.renderer?.drawToRenderPass(pass, view, options)
  }

  public setHostHoveredPoint (index?: number): void {
    if (this.isDestroyed) return
    this.simulation.store.hostHoveredPointIndex = index
    this.requestFrame()
  }

  public setHostHoveredLink (index?: number): void {
    if (this.isDestroyed) return
    this.simulation.store.hostHoveredLinkIndex = index
    this.requestFrame()
  }

  public start (alpha = 1): void {
    this.whenReady(() => {
      this.interruptPositionTransition()
      this.simulation.start(alpha)
      this.requestFrame()
    })
  }

  public stop (): void { this.whenReady(() => this.simulation.stop()) }
  public pause (): void { this.whenReady(() => this.simulation.pause()) }
  public unpause (): void {
    this.whenReady(() => {
      this.interruptPositionTransition()
      this.simulation.unpause()
      this.requestFrame()
    })
  }

  public step (): void {
    this.whenReady(() => {
      this.runSimulationStep(true)
      this.requestFrame()
    })
  }

  public setPointPositions (positions: Float32Array, dontRescale?: boolean): void {
    this.queueStyleData(() => {
      this.invalidateQueries()
      this.simulation.setPointPositions(positions, dontRescale)
      this.transition.queue(TransitionProperty.Positions)
    })
  }

  public setLinks (links: Float32Array): void {
    this.queueStyleData(() => { this.invalidateQueries(); this.simulation.setLinks(links) })
  }

  public setPointPosition (id: number, x: number, y: number): void { this.setPointPositionsByIndices([id], [x, y]) }
  public setPointPositionsByIndices (ids: number[], positions: number[] | Float32Array): void {
    this.whenReady(() => {
      this.revision++
      this.tracker?.setIndices(this.tracker.indices)
      this.simulation.setPointPositionsByIndices(ids, positions)
      this.requestFrame()
    })
  }

  public setPinnedPoints (ids: number[] | null): void { this.whenReady(() => this.simulation.setPinnedPoints(ids)) }
  public setPinnedPoint (id: number, pinned: boolean): void { this.whenReady(() => this.simulation.setPinnedPoint(id, pinned)) }
  public isPointPinned (id: number): boolean { return this.simulation.isPointPinned(id) }
  public setPointSizes (sizes: Float32Array): void {
    this.whenReady(() => { this.simulation.setPointSizes(sizes); this.transition.queue(TransitionProperty.PointSizes) })
  }

  public setLinkStrength (weights: Float32Array): void { this.whenReady(() => this.simulation.setLinkStrength(weights)) }
  public setPointClusters (ids: (number | undefined)[]): void { this.whenReady(() => this.simulation.setPointClusters(ids)) }
  public setClusterPositions (xy: (number | undefined)[]): void { this.whenReady(() => this.simulation.setClusterPositions(xy)) }
  public setPointClusterStrength (value: Float32Array): void { this.whenReady(() => this.simulation.setPointClusterStrength(value)) }
  public setPointAttractors (xy: Float32Array): void { this.whenReady(() => this.simulation.setPointAttractors(xy)) }
  public setPointAttractorStrength (value: Float32Array): void { this.whenReady(() => this.simulation.setPointAttractorStrength(value)) }
  public getClusterPositionsAsync (): Promise<number[]> { return this.simulation.getClusterPositionsAsync() }
  /** WebGPU always returns the latest completed sample. Await getClusterPositionsAsync for a fresh one. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getClusterPositions (_options?: PositionsReadOptions): readonly number[] {
    const version = this.getPointPositionBuffer()?.version
    if (version !== undefined && version !== this.clusterVersion && !this.clusterRead) {
      const revision = this.revision
      this.clusterRead = this.getClusterPositionsAsync().then(xy => {
        if (revision === this.revision) { this.clusterPositions = xy; this.clusterVersion = version }
      }).catch(error => this.reportReadError(error)).finally(() => { this.clusterRead = undefined })
    }
    return this.clusterPositions
  }

  public setPointColors (value: Float32Array): void {
    this.whenReady(() => { this.graph.inputPointColors = value; this.transition.queue(TransitionProperty.PointColors) })
  }

  public setPointShapes (value: Float32Array): void { this.queueStyleData(() => { this.graph.inputPointShapes = value }) }
  public setPointRenderOrder (value: ArrayLike<number> | null): void { this.queueStyleData(() => { this.graph.inputPointRenderOrder = value ?? undefined }) }
  public setPointRingColors (value: Float32Array): void { this.queueStyleData(() => { this.graph.inputPointRingColors = value }) }
  public setPointStrokeColors (value: Float32Array): void {
    this.queueStyleData(() => { this.graph.inputPointStrokeColors = value; this.transition.queue(TransitionProperty.PointStrokeColors) })
  }

  public setPointStrokeWidths (value: Float32Array): void {
    this.queueStyleData(() => { this.graph.inputPointStrokeWidths = value; this.transition.queue(TransitionProperty.PointStrokeWidths) })
  }

  public setLinkWidths (value: Float32Array): void {
    this.whenReady(() => { this.graph.inputLinkWidths = value; this.transition.queue(TransitionProperty.LinkWidths) })
  }

  public setLinkColors (value: Float32Array): void {
    this.queueStyleData(() => { this.graph.inputLinkColors = value; this.transition.queue(TransitionProperty.LinkColors) })
  }

  public setImageData (value: ImageData[]): void { this.queueStyleData(() => { this.graph.inputImageData = value }) }
  public setPointImageIndices (value: Float32Array): void { this.queueStyleData(() => { this.graph.inputPointImageIndices = value }) }
  public setPointImageSizes (value: Float32Array): void { this.queueStyleData(() => { this.graph.inputPointImageSizes = value }) }
  public setLinkStyles (value: Float32Array): void { this.queueStyleData(() => { this.graph.inputLinkStyles = value }) }
  public setLinkArrows (value: boolean[]): void { this.queueStyleData(() => { this.graph.linkArrowsBoolean = value }) }

  public getPointPositionBuffer (): PointPositionBuffer | undefined { return this.simulation.getPointPositionBuffer() }
  public getPointPositionsAsync (out?: Float32Array): Promise<Float32Array> { return this.simulation.getPointPositionsAsync(out) }
  public getNeighboringPointIndices (ids: number | number[]): number[] { return this.graph.getNeighboringPointIndices(ids) }
  public getConnectedLinkIndices (ids: number | number[]): number[] { return this.graph.getConnectedLinkIndices(ids) }
  public getConnectedPointIndices (ids: number | number[]): number[] { return this.graph.getConnectedPointIndices(ids) }
  /** The displayed shape size or, for a point with a larger image, its image size. */
  public getPointRadiusByIndex (index: number): number | undefined {
    if (this.isDestroyed || !this.graph.isPointIndex(index)) return undefined
    const size = this.transition.isActiveFor(TransitionProperty.PointSizes) ? this.renderer?.getPointSize(index, this.transition.progress) : undefined
    return this.graph.getResolvedPointFootprint(index, size)
  }

  /** The width at the current animation frame, in the same units as setLinkWidths(). */
  public getLinkWidthByIndex (index: number): number | undefined {
    if (this.isDestroyed || this.graph.linkWidths?.[index] === undefined) return undefined
    const width = this.transition.isActiveFor(TransitionProperty.LinkWidths) ? this.renderer?.getLinkWidth(index, this.transition.progress) : undefined
    return width ?? this.graph.getResolvedLinkWidth(index)
  }

  public getPointSizes (): Float32Array { return Float32Array.from({ length: this.graph.pointsNumber ?? 0 }, (_, id) => this.graph.getResolvedPointSize(id)) }
  public getLinkWidths (): Float32Array { return Float32Array.from({ length: this.graph.linksNumber ?? 0 }, (_, id) => this.graph.getResolvedLinkWidth(id)) }
  public getPointColors (): Float32Array { return Float32Array.from({ length: 4 * (this.graph.pointsNumber ?? 0) }, (_, i) => this.graph.getResolvedPointColorChannel(Math.floor(i / 4), i % 4)) }
  public getLinkColors (): Float32Array { return Float32Array.from({ length: 4 * (this.graph.linksNumber ?? 0) }, (_, i) => this.graph.getResolvedLinkColorChannel(Math.floor(i / 4), i % 4)) }
  public getLinkStyles (): Float32Array { return this.graph.linkStyles ?? new Float32Array(0) }

  public setConfig (config: GraphConfig): void { this.updateConfig(config, true) }
  public setConfigPartial (config: GraphConfig): void { this.updateConfig(config, false) }

  public spaceToScreenPosition (point: Pair): Pair { return this.camera.convertSpaceToScreenPosition(point) }
  public screenToSpacePosition (point: Pair): Pair { return this.camera.convertScreenToSpacePosition(point) }
  public spaceToScreenRadius (radius: number): number { return this.camera.convertSpaceToScreenRadius(radius) }
  public getScaleX (): ((x: number) => number) | undefined { return this.simulation.scaleX }
  public getScaleY (): ((y: number) => number) | undefined { return this.simulation.scaleY }
  public getZoomLevel (): number { return this.camera.eventTransform.k }

  public setViewTransform (transform: { k: number; x: number; y: number }, size?: Pair): void {
    this.whenReady(() => {
      this.fitRequest++
      if (size) this.simulation.store.updateScreenSize(...size)
      this.applyView(zoomIdentity.translate(transform.x, transform.y).scale(transform.k), 0)
    })
  }

  public zoom (scale: number, duration = 0, enableSimulation = true): void { this.setZoomLevel(scale, duration, enableSimulation) }
  public setZoomLevel (scale: number, duration = 0, enableSimulation = true): void {
    this.whenReady(() => {
      if (!this.canvas || !Number.isFinite(scale) || scale <= 0) return
      this.fitRequest++
      this.camera.shouldEnableSimulationDuringZoomOverride = enableSimulation
      const selection = select<HTMLCanvasElement, undefined>(this.canvas)
      if (duration > 0) selection.transition().duration(duration).call(this.camera.behavior.scaleTo, scale)
      else selection.call(this.camera.behavior.scaleTo, scale)
    })
  }

  public fitView (duration = 250, padding = 0.1, enableSimulation = true): void {
    this.fitResult(() => this.simulation.getBoundsAsync(), duration, padding, enableSimulation)
  }

  public fitViewByPointIndices (ids: number[], duration = 250, padding = 0.1, enableSimulation = true): void {
    this.fitResult(() => this.simulation.getPointPositionsByIndicesAsync(ids), duration, padding, enableSimulation)
  }

  public fitViewByPointPositions (xy: number[], duration = 250, padding = 0.1, enableSimulation = true): void {
    this.setZoomTransformByPointPositions(Float32Array.from(xy), duration, undefined, padding, enableSimulation)
  }

  public setZoomTransformByPointPositions (xy: Float32Array, duration = 250, scale?: number, padding = 0.1, enableSimulation = true): void {
    this.whenReady(() => {
      this.fitRequest++
      this.camera.shouldEnableSimulationDuringZoomOverride = enableSimulation
      this.applyView(this.camera.getTransform(xy, scale, padding), duration)
    })
  }

  public zoomToPointByIndex (id: number, duration = 700, scale = 3, canZoomOut = true, enableSimulation = true): void {
    this.fitResult(() => this.simulation.getPointPositionsByIndicesAsync([id]), duration, 0, enableSimulation, canZoomOut ? scale : Math.max(this.getZoomLevel(), scale))
  }

  public findPointsInRectAsync (rect: [Pair, Pair]): Promise<number[] | null> { return this.selectArea({ rect }) }
  public findPointsInPolygonAsync (polygon: Pair[]): Promise<number[] | null> { return this.selectArea({ polygon }) }
  /** Set the indices followed by this Graph's tracker. Other simulation trackers keep their own sets. */
  public trackPointPositionsByIndices (ids: number[]): void {
    if (this.isDestroyed) return
    if (this.tracker) this.tracker.setIndices(ids ?? [])
    else this.tracker = this.simulation.trackPoints(ids ?? [])
  }

  /** Capture the tracked positions now. A data replacement or disposal can invalidate the result. */
  public async getTrackedPointPositionsMapAsync (): Promise<ReadonlyMap<number, Pair> | null> {
    if (this.isDestroyed) return null
    if (!this.tracker) return new Map()
    const revision = this.revision
    const positions = await this.tracker.positionsAsync()
    return revision === this.revision && !this.isDestroyed ? positions : null
  }

  /** The last completed gather. Use getTrackedPointPositionsMapAsync for a fresh snapshot. */
  public getTrackedPointPositionsMap (options?: PositionsReadOptions): ReadonlyMap<number, Pair> {
    return this.tracker?.positions(options) ?? new Map()
  }

  public getTrackedPointPositionsArray (): number[] {
    return this.tracker?.positionsArray() ?? []
  }

  /** The WebGPU sample is always non-blocking. The first request schedules a GPU copy. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getSampledPointPositionsMap (_options?: PositionsReadOptions): Map<number, Pair> {
    const samples = new Map<number, Pair>()
    for (const [id, [x, y]] of this.sampleLabels(false)) samples.set(id, [x, y])
    return samples
  }

  public getSampledPoints (options?: PositionsReadOptions): { indices: number[]; positions: number[] } {
    const points = this.getSampledPointPositionsMap(options)
    return { indices: [...points.keys()], positions: [...points.values()].flat() }
  }

  public getSampledLinkPositionsMap (): Map<number, [number, number, number]> { return new Map(this.sampleLabels(true)) }
  public getSampledLinks (): { indices: number[]; positions: number[]; angles: number[] } {
    const indices: number[] = []; const positions: number[] = []; const angles: number[] = []
    for (const [id, [x, y, angle]] of this.sampleLabels(true)) {
      indices.push(id); positions.push(x, y); angles.push(angle)
    }
    return { indices, positions, angles }
  }

  public destroy (): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.isReady = false
    this.fitRequest++
    this.revision++
    this.pending.length = 0
    cancelAnimationFrame(this.frame)
    clearTimeout(this.fitTimer)
    this.observer?.disconnect()
    this.listeners.abort()
    this.refreshHoverAfterDraw = undefined
    if (this.canvas) select(this.canvas).interrupt().on('.zoom', null).on('.drag', null)
    this.area?.destroy()
    this.labels?.destroy()
    this.positionTransition?.destroy()
    this.renderer?.destroy()
    if (this.simulation.ownsDevice) this.canvas?.remove()
    this.simulation.destroy()
    this.tracker = undefined
    this.attribution?.remove()
  }

  private drawFrame (): void {
    if (!this.canvas || this.isDestroyed) return
    const refreshHover = this.hasHoverSceneChanged || this.transition.isActive
    this.hasHoverSceneChanged = false
    if (this.transition.isActive) {
      const positions = this.transition.isActiveFor(TransitionProperty.Positions)
      this.transition.step()
      const live = this.getPointPositionBuffer()
      if (positions && live && this.positionTransition?.write(live, this.transition.progress)) this.simulation.markPositionsChanged()
    }
    this.renderer?.draw(this.view())
    this.refreshHoverAfterDraw?.(refreshHover)
  }

  private runSimulationStep (forceExecution = false, measureOccupancy = false): void {
    if (!this.hasRendered) return
    const simulateDuringZoom = this.camera.shouldEnableSimulationDuringZoomOverride ?? this.config.enableSimulationDuringZoom
    const blocked = this.transition.isActiveFor(TransitionProperty.Positions) || (this.camera.isRunning && !simulateDuringZoom)
    const pointer = this.config.enableRightClickRepulsion ? this.mouseRepulsion : undefined
    this.simulation.runSimulationStep(forceExecution, pointer, blocked, measureOccupancy)
  }

  private queueStyleData (setter: () => void): void {
    this.whenReady(() => {
      this.shouldUpdateAllStyles = true
      setter()
    })
  }

  private whenReady (operation: () => void): void {
    if (this.isDestroyed) return
    if (this.isReady) operation()
    else this.pending.push(operation)
  }

  private view (pixelRatio = this.config.pixelRatio): GraphView {
    const {
      screenSize: [width, height], worldOrigin, transform, hostHoveredPointIndex, hostHoveredLinkIndex,
    } = this.simulation.store
    const { x, y, k } = this.camera.eventTransform
    return {
      width,
      height,
      pixelRatio,
      scale: k,
      x: x + k * (width / 2 - worldOrigin[0]),
      y: y + k * (height / 2 + worldOrigin[1]),
      hoveredPoint: this.config.renderHoveredPointRing ? this.hoveredPoint : undefined,
      hostHoveredPoint: hostHoveredPointIndex,
      hoveredLink: hostHoveredLinkIndex ?? this.hoveredLink,
      pointProjection: { origin: worldOrigin, transform: [transform[0], transform[4], transform[6], transform[7]] },
      styleProgress: this.transition.progress,
      previousPositions: this.positionTransition?.source,
    }
  }

  private resize (): void {
    if (!this.canvas || !this.container || this.isDestroyed) return
    const { width, height } = this.container.getBoundingClientRect()
    const cssWidth = Math.max(1, Math.round(width))
    const cssHeight = Math.max(1, Math.round(height))
    const w = Math.max(1, Math.round(cssWidth * this.config.pixelRatio))
    const h = Math.max(1, Math.round(cssHeight * this.config.pixelRatio))
    const { store } = this.simulation
    if (this.containerSize?.[0] === cssWidth && this.containerSize[1] === cssHeight && this.canvas.width === w && this.canvas.height === h) return
    this.containerSize = [cssWidth, cssHeight]
    const center = this.screenToSpacePosition([store.screenSize[0] / 2, store.screenSize[1] / 2])
    const hadSize = store.screenSize[0] > 0
    store.updateScreenSize(cssWidth, cssHeight)
    this.canvas.width = w
    this.canvas.height = h
    this.simulation.device!.canvasContext!.resize({ width: w, height: h })
    if (hadSize) this.applyView(this.camera.getTransform(center, this.getZoomLevel()), 0)
    this.requestFrame()
  }

  private updateAttribution (): void {
    this.attribution?.remove()
    if (!this.container || !this.config.attribution) return
    this.attribution = document.createElement('div')
    this.attribution.style.cssText = 'position:absolute;right:0;bottom:0;margin:0.6rem;font-size:0.7rem'
    this.attribution.innerHTML = sanitizeHtml(this.config.attribution, {
      ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'span', 'div', 'p', 'br', 'img'],
      ALLOWED_ATTR: ['href', 'target', 'class', 'id', 'style', 'src', 'alt', 'title'],
    })
    this.container.append(this.attribution)
  }

  private requestFrame (): void {
    if (this.isDestroyed || !this.canvas || !this.config.enableRenderLoop || this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      const device = this.simulation.device
      if (this.isDestroyed || !device || device.isLost) return
      // A pointer read joins the same GPU queue. Leave at most one autonomous
      // simulation and draw ahead of it, even when a frame spans many refreshes.
      if (this.isFrameInFlight) {
        this.requestFrame()
        return
      }
      this.isAutomaticFrame = true
      try { this.renderOneFrame() } finally { this.isAutomaticFrame = false }
      if (this.isDestroyed || device.isLost) return
      const fence = device.createFence()
      this.isFrameInFlight = true
      const release = (): void => {
        fence.destroy()
        this.isFrameInFlight = false
      }
      fence.signaled.then(release, release)
      if (this.hasRendered && (this.isSimulationRunning || this.transition.isActive || this.mouseRepulsion)) this.requestFrame()
    })
  }

  private interruptPositionTransition (): void {
    if (this.transition.isActiveFor(TransitionProperty.Positions)) {
      this.transition.end(true)
      this.positionTransition?.clear()
    }
  }

  private invalidateQueries (): void {
    this.revision++
    this.fitRequest++
    this.tracker?.setIndices(this.tracker.indices)
    this.clusterVersion = -1
    this.clusterPositions = []
    this.labels?.invalidate()
    // A setter queues data. Keep the displayed hover until render applies it and
    // the next pick identifies what now occupies the same screen location.
    this.hoverRequest++
  }

  private updateConfig (config: GraphConfig, reset: boolean): void {
    validateConfig(config)
    this.whenReady(() => {
      const previous = { ...this.config }
      if (reset) resetConfigToDefaults(this.config)
      applyConfig(this.config, config, !reset)
      this.config.initialZoomLevel = previous.initialZoomLevel
      this.config.randomSeed = previous.randomSeed
      this.config.attribution = previous.attribution

      // The next area query reads its mode directly. Rebuilding styles here
      // would discard a size transition's displayed value when changing modes.
      const keys = Object.keys(config)
      if (!reset && keys.length === 1 && keys[0] === 'pointSelectionMode') return
      this.hasHoverSceneChanged = true
      this.hoverRequest++
      if (!reset && this.hasRendered && keys.length === 1 && keys[0] === 'highlightedPointIndices') {
        // Highlights change paint and picking order. The selection footprint stays valid.
        this.renderer?.updatePointHighlights()
        this.requestFrame()
        return
      }

      const rebuilding = previous.spaceSize !== this.config.spaceSize || (!previous.enableSimulation && this.config.enableSimulation)
      if (rebuilding) {
        this.interruptPositionTransition()
        this.transition.dequeueAll()
      }
      this.simulation.applyConfigChanges(previous)
      if (rebuilding) this.hasRendered = !!this.graph.pointsNumber

      // Applying unrelated config must not consume point or link data queued for the next render.
      if (previous.pointDefaultColor !== this.config.pointDefaultColor) this.graph.updatePointColor()
      if (previous.pointDefaultSize !== this.config.pointDefaultSize) this.graph.updatePointImageSizes()
      if (previous.pointDefaultShape !== this.config.pointDefaultShape) this.graph.updatePointShape()
      if (previous.linkDefaultColor !== this.config.linkDefaultColor) this.graph.invalidateLinkDefaultColor()
      if (previous.linkDefaultStyle !== this.config.linkDefaultStyle) this.graph.updateLinkStyles()
      if (previous.linkDefaultArrows !== this.config.linkDefaultArrows) this.graph.updateArrows()
      const defaultsOnly = !reset && this.hasRendered && !this.shouldUpdateAllStyles && keys.length > 0 &&
        keys.every(key => key === 'pointDefaultColor' || key === 'pointDefaultSize')
      const pointChannels = defaultsOnly ? { colors: keys.includes('pointDefaultColor'), sizes: keys.includes('pointDefaultSize') } : undefined
      this.renderer?.update({ pointChannels })
      if (!pointChannels || pointChannels.sizes) this.area?.invalidateFootprints()
      if (previous.pixelRatio !== this.config.pixelRatio) this.resize()
      if (!this.config.enableRenderLoop && this.frame) {
        cancelAnimationFrame(this.frame)
        this.frame = 0
      }
      if (this.canvas) this.canvas.style.touchAction = this.config.enableDrag || this.config.enableZoom ? 'none' : ''
      this.requestFrame()
    })
  }

  private applyView (transform: ZoomTransform, duration: number): void {
    if (!this.canvas) {
      this.camera.applyEventTransform(transform)
      return
    }
    const selection = select<HTMLCanvasElement, undefined>(this.canvas)
    selection.interrupt()
    if (duration > 0) selection.transition().duration(duration).call(this.camera.behavior.transform, transform)
    else selection.call(this.camera.behavior.transform, transform)
  }

  private fitResult (read: () => PromiseLike<ArrayLike<number> | undefined>, duration: number, padding: number, enableSimulation: boolean, scale?: number): void {
    this.whenReady(() => {
      const token = ++this.fitRequest
      Promise.resolve(read()).then(positions => {
        if (positions?.length && token === this.fitRequest && !this.isDestroyed) {
          this.camera.shouldEnableSimulationDuringZoomOverride = enableSimulation
          this.applyView(this.camera.getTransform(Float32Array.from(positions), scale, padding), duration)
        }
      }).catch(error => { if (!this.isDestroyed && !this.simulation.device?.isLost) console.error(error) })
    })
  }

  private async selectArea (area: Area): Promise<number[] | null> {
    if ('polygon' in area && area.polygon.length < 3) return []
    const source = this.getPointPositionBuffer()
    if (!source || !this.canvas || this.isDestroyed) return this.isReady ? [] : null
    const revision = this.revision
    this.area ??= new AreaSelection(source.device)
    try {
      const ids = await this.area.select(source.buffer, this.graph, this.config, this.simulation.store, area)
      return this.isDestroyed || this.revision !== revision || source.device.isLost ? null : ids
    } catch (error) {
      if (this.isDestroyed || this.revision !== revision || source.device.isLost) return null
      throw error
    }
  }

  private reportReadError (error: unknown): void {
    if (!this.isDestroyed && !this.simulation.device?.isLost) console.error(error)
  }

  private sampleLabels (links: boolean): ReadonlyMap<number, [number, number, number]> {
    const source = this.getPointPositionBuffer()
    if (!source || (links && !this.graph.links?.length)) return new Map()
    const { curvedLinks, curvedLinkWeight, curvedLinkSegments, curvedLinkControlPointDistance } = this.config
    const bend = curvedLinks && curvedLinkSegments > 1 ? curvedLinkControlPointDistance * curvedLinkWeight / (1 + curvedLinkWeight) : 0
    const spacing = links ? this.config.linkSamplingDistance : this.config.pointSamplingDistance
    this.labels ??= new LabelSampling(source.device)
    const fallback = links ? defaultConfigValues.linkSamplingDistance : defaultConfigValues.pointSamplingDistance
    return this.labels.sample(source, this.view(), spacing || fallback, links ? this.graph.links : undefined, bend, this.graph.pointRenderOrder)
  }

  private clearHover (event?: MouseEvent): void {
    this.hoverRequest++
    this.applyHover({}, event)
  }

  private async pickAt (clientX: number, clientY: number): Promise<PointerHit | null> {
    const canvas = this.canvas
    if (!this.renderer || !canvas || !this.hasRendered || this.isDestroyed) return null
    const revision = this.revision
    const valid = (): boolean => !this.isDestroyed && !this.simulation.device?.isLost && revision === this.revision
    const bounds = canvas.getBoundingClientRect()
    const view = this.view()
    // Only the pointer's own hover changes the link index used by canvas events.
    // A host hover affects the visible and borrowed-pass draws.
    view.hoveredLink = this.hoveredLink
    const hit = await this.renderer.pick(clientX - bounds.left, clientY - bounds.top, view)
    if (!valid()) return null
    const point = hit?.kind === 'point' ? hit.index : undefined
    const link = hit?.kind === 'link' ? hit.index : undefined
    let position: Pair | undefined
    if (point !== undefined) {
      const coords = await this.simulation.getPointPositionsByIndicesAsync([point])
      if (!valid() || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return null
      position = [coords[0]!, coords[1]!]
    }
    return { point, link, position }
  }

  private applyHover ({ point, link, position }: PointerHit, event?: MouseEvent): void {
    const prevPoint = this.hoveredPoint
    const prevLink = this.hoveredLink
    this.hoveredPoint = point
    this.hoveredLink = link
    this.simulation.store.hoveredPoint = point !== undefined && position ? { index: point, position } : undefined
    this.simulation.store.hoveredLinkIndex = link
    if (point === prevPoint && link === prevLink) return
    if (this.canvas) this.canvas.style.cursor = point !== undefined ? this.config.hoveredPointCursor : link !== undefined ? this.config.hoveredLinkCursor : ''
    // Like WebGL, moving directly between two points (or two links) reports
    // the new index. Switching between a point and a link sends out before over.
    if (prevPoint !== undefined && point === undefined) this.config.onPointMouseOut?.(event)
    if (prevLink !== undefined && link === undefined) this.config.onLinkMouseOut?.(event)
    if (point !== undefined && position && prevPoint !== point) {
      this.config.onPointMouseOver?.(point, position, event,
        !!this.config.highlightedPointIndices?.includes(point), !!this.config.outlinedPointIndices?.includes(point))
    }
    if (link !== undefined && prevLink !== link) this.config.onLinkMouseOver?.(link)
    this.requestFrame()
  }

  private async hit (event: MouseEvent, action: 'click' | 'context'): Promise<void> {
    const hit = await this.pickAt(event.clientX, event.clientY)
    if (!hit) return
    const { point, link, position } = hit
    if (action === 'click') {
      this.config.onClick?.(point, position, event)
      if (point !== undefined && position) this.config.onPointClick?.(point, position, event)
      else if (link !== undefined) this.config.onLinkClick?.(link, event)
      else this.config.onBackgroundClick?.(event)
    } else {
      this.config.onContextMenu?.(point, position, event)
      if (point !== undefined && position) this.config.onPointContextMenu?.(point, position, event)
      else if (link !== undefined) this.config.onLinkContextMenu?.(link, event)
      else this.config.onBackgroundContextMenu?.(event)
    }
  }

  private bindInput (canvas: HTMLCanvasElement): void {
    const options = { signal: this.listeners.signal }
    const dispatch = (event: MouseEvent, action: 'click' | 'context'): void => {
      this.hit(event, action).catch(error => this.reportReadError(error))
    }
    let cursor: MouseEvent | undefined
    let pointerEvent: MouseEvent | undefined
    let positionVersion: number | undefined
    let picking = false
    let needsPick = false
    // A moving layout can draw again before the readback completes. Keep one
    // read in flight and sample the latest scene once when it finishes.
    const refreshHover = (): void => {
      if (!cursor || this.drag.isActive || isPressPending() || this.isDestroyed) return
      positionVersion = this.getPointPositionBuffer()?.version
      if (picking) { needsPick = true; return }
      picking = true
      needsPick = false
      const token = this.hoverRequest
      const event = pointerEvent
      pointerEvent = undefined
      this.pickAt(cursor.clientX, cursor.clientY).then(hit => {
        if (hit && token === this.hoverRequest) this.applyHover(hit, event)
      }).catch(error => this.reportReadError(error)).finally(() => {
        picking = false
        if (needsPick) refreshHover()
      })
    }
    this.refreshHoverAfterDraw = (sceneChanged): void => {
      if (cursor && (sceneChanged || positionVersion !== this.getPointPositionBuffer()?.version)) refreshHover()
    }
    const updateMouseRepulsion = (event: MouseEvent): void => {
      if (event.buttons & 2 && this.config.enableRightClickRepulsion) {
        const bounds = canvas.getBoundingClientRect()
        this.mouseRepulsion = this.screenToSpacePosition([event.clientX - bounds.left, event.clientY - bounds.top])
        this.requestFrame()
      } else this.mouseRepulsion = undefined
    }
    canvas.addEventListener('mousedown', updateMouseRepulsion, options)
    window.addEventListener('mouseup', () => { this.mouseRepulsion = undefined }, options)
    const leave = (event?: MouseEvent): void => {
      cursor = pointerEvent = undefined
      needsPick = false
      this.mouseRepulsion = undefined
      this.clearHover(event)
    }
    window.addEventListener('blur', () => { leave(); this.simulation.store.isSpaceKeyPressed = false }, options)
    window.addEventListener('keydown', event => { if (event.code === 'Space') this.simulation.store.isSpaceKeyPressed = true }, options)
    window.addEventListener('keyup', event => { if (event.code === 'Space') this.simulation.store.isSpaceKeyPressed = false }, options)
    canvas.addEventListener('mousemove', event => {
      updateMouseRepulsion(event)
      cursor = event
      this.hoverRequest++
      const hovered = this.simulation.store.hoveredPoint
      this.config.onMouseMove?.(hovered?.index, hovered?.position, event)
      if (!this.drag.isActive && !isPressPending()) {
        pointerEvent = event
        refreshHover()
      }
    }, options)
    canvas.addEventListener('mouseleave', leave, options)
    canvas.addEventListener('click', event => dispatch(event, 'click'), options)
    canvas.addEventListener('contextmenu', event => {
      if (this.config.enableRightClickRepulsion) event.preventDefault()
      if (this.config.onContextMenu || this.config.onPointContextMenu || this.config.onLinkContextMenu || this.config.onBackgroundContextMenu) {
        event.preventDefault()
        dispatch(event, 'context')
      }
    }, options)
    const behavior = this.drag.behavior.container(canvas)
    behavior.filter(event => this.config.enableDrag && !event.ctrlKey && !event.button)
    behavior.on('start.webgpu', event => {
      const index = this.simulation.store.draggingPointIndex
      if (index === undefined) return
      const mouse = this.screenToSpacePosition([event.x, event.y])
      const center = this.simulation.store.hoveredPoint?.position ?? mouse
      this.dragged = { index, pinned: this.isPointPinned(index), offset: [center[0] - mouse[0], center[1] - mouse[1]] }
      this.setPinnedPoint(index, true)
    }).on('drag.webgpu', event => {
      if (this.dragged) {
        const [x, y] = this.screenToSpacePosition([event.x, event.y])
        this.setPointPosition(this.dragged.index, x + this.dragged.offset[0], y + this.dragged.offset[1])
      }
    }).on('end.webgpu', event => {
      if (this.dragged) this.setPinnedPoint(this.dragged.index, this.dragged.pinned)
      this.dragged = undefined
      if (cursor && event.sourceEvent && 'clientX' in event.sourceEvent) cursor = event.sourceEvent
      this.hasHoverSceneChanged = true
      this.requestFrame()
    })
    this.camera.behavior.on('zoom.webgpu', event => {
      if (cursor && event.sourceEvent && 'clientX' in event.sourceEvent) cursor = event.sourceEvent
      this.hasHoverSceneChanged = true
      this.hoverRequest++
      this.requestFrame()
    })
    const node = select<HTMLCanvasElement, undefined>(canvas)
    node.call(behavior).call(this.camera.behavior)
    const isPressPending = bindPressPicking(node, {
      signal: this.listeners.signal,
      canDrag: event => this.config.enableDrag && !event.ctrlKey && (!('button' in event) || !event.button) &&
        !this.simulation.store.isSpaceKeyPressed && !this.transition.isActiveFor(TransitionProperty.Positions) &&
        !this.transition.isActiveFor(TransitionProperty.PointSizes),
      pick: async (clientX, clientY) => {
        pointerEvent = undefined
        needsPick = false
        this.hoverRequest++
        const hit = await this.pickAt(clientX, clientY)
        if (!hit) return null
        return hit.point !== undefined && hit.position ? { index: hit.point, position: hit.position } : undefined
      },
      setSubject: point => { this.simulation.store.hoveredPoint = point },
      onError: error => { if (!this.isDestroyed && !this.simulation.device?.isLost) console.error(error) },
    })
    canvas.style.touchAction = this.config.enableDrag || this.config.enableZoom ? 'none' : ''
  }
}
