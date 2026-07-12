import { select, Selection } from 'd3-selection'
import 'd3-transition'
import { easeQuadInOut, easeQuadIn, easeQuadOut } from 'd3-ease'
import { D3ZoomEvent } from 'd3-zoom'
import { D3DragEvent } from 'd3-drag'
import { Device, Framebuffer, luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { applyConfig, createDefaultConfig, resetConfigToDefaults, GraphConfigInterface, type GraphConfig } from '@/graph/config'
import { getRgbaColor, getMaxPointSize, readPixels, extractIndicesFromPixels, sanitizeHtml } from '@/graph/helper'
import { ForceCenter } from '@/graph/modules/ForceCenter'
import { ForceCollision } from '@/graph/modules/ForceCollision'
import { ForceGravity } from '@/graph/modules/ForceGravity'
import { ForceLink, LinkDirection } from '@/graph/modules/ForceLink'
import { ForceManyBody } from '@/graph/modules/ForceManyBody'
import { Clusters } from '@/graph/modules/Clusters'
import { FPSMonitor } from '@/graph/modules/FPSMonitor'
import { GraphData } from '@/graph/modules/GraphData'
import { Lines } from '@/graph/modules/Lines'
import { Points } from '@/graph/modules/Points'
import { Store, ALPHA_MIN, MAX_HOVER_DETECTION_DELAY, MIN_MOUSE_MOVEMENT_THRESHOLD, type Hovered } from '@/graph/modules/Store'
import { Transition, TransitionProperty } from '@/graph/modules/Transition'
import { Zoom } from '@/graph/modules/Zoom'
import { Drag } from '@/graph/modules/Drag'
import { Camera, type Camera3dState } from '@/graph/modules/Camera'

/** Touch/pen long-press → context menu thresholds. */
const LONG_PRESS_DURATION_MS = 500
const LONG_PRESS_MOVE_THRESHOLD_PX = 10

/** Monotonic id giving each Graph instance its own d3 event namespace on `document`. */
let graphInstanceCounter = 0

type ZoomGestureEvent = Event & { ctrlKey?: boolean; button?: number; touches?: TouchList }
/** d3-zoom's default gesture filter, restored when `enableZoom` is on. */
const defaultZoomGestureFilter = (event: ZoomGestureEvent): boolean =>
  (!event.ctrlKey || event.type === 'wheel') && !event.button
/**
 * Gesture filter for `enableZoom: false`: panning/orbiting must keep working, so
 * only the second touch point (which would start a pinch-zoom) is rejected —
 * wheel and double-click zoom have their listeners unbound separately.
 */
const panOnlyZoomGestureFilter = (event: ZoomGestureEvent): boolean =>
  defaultZoomGestureFilter(event) && (event.touches === undefined || event.touches.length < 2)

export class Graph {
  /** Current graph configuration. Always fully populated with default values for any unset properties. */
  public config: GraphConfigInterface = createDefaultConfig()
  public graph = new GraphData(this.config)
  /** Promise that resolves when the graph is fully initialized and ready to use */
  public readonly ready: Promise<void>
  /** Whether the graph has completed initialization */
  public isReady = false
  private readonly deviceInitPromise: Promise<Device>
  /** Canvas element, assigned asynchronously during device initialization */
  private canvas!: HTMLCanvasElement
  private attributionDivElement: HTMLElement | undefined
  private canvasD3Selection: Selection<HTMLCanvasElement, undefined, null, undefined> | undefined
  /**
   * d3 event namespace for listeners on shared elements (`document`). Canvas
   * listeners can use the plain `.cosmos` namespace — the canvas is per-instance.
   */
  private readonly documentEventsNamespace = `cosmos-${graphInstanceCounter++}`
  private device: Device | undefined
  /**
   * Tracks whether this Graph instance owns the device and should destroy it on cleanup.
   * Set to `true` when Graph creates its own device, `false` when using an external device.
   * When `false`, the external device lifecycle is managed by the user.
   */
  private shouldDestroyDevice: boolean
  private requestAnimationFrameId = 0
  /**
   * With on-demand rendering nothing polls the canvas size while idle;
   * this observer schedules a redraw on element resize. The actual
   * screen-size/zoom-transform update stays in resizeCanvas() inside the frame.
   */
  private resizeObserver: ResizeObserver | undefined
  /**
   * Touch/pen long-press timer. Set on pointerdown for non-mouse pointers and
   * cancelled on pointerup, pointercancel, or movement past
   * LONG_PRESS_MOVE_THRESHOLD_PX. When it fires, the contextmenu callback chain
   * runs and the synthesized click is suppressed.
   */
  private _longPressTimerId: number | undefined
  private _longPressStartX = 0
  private _longPressStartY = 0
  /**
   * Set when long-press fires contextmenu (or a browser-dispatched contextmenu
   * handles itself) so the synthesized click that follows the same touch is
   * dropped instead of routed to onPointClick/onBackgroundClick/onLinkClick.
   * Consumed by onClick; also cleared on next pointerdown.
   */
  private _shouldSuppressNextClick = false

  private store = new Store()
  private points: Points | undefined
  private lines: Lines | undefined
  private forceGravity: ForceGravity | undefined
  private forceCenter: ForceCenter | undefined
  private forceManyBody: ForceManyBody | undefined
  private forceLinkIncoming: ForceLink | undefined
  private forceLinkOutgoing: ForceLink | undefined
  private forceCollision: ForceCollision | undefined
  private clusters: Clusters | undefined
  private zoomInstance = new Zoom(this.store, this.config)
  private transition = new Transition(this.config)
  private dragInstance = new Drag(this.store, this.config, this.transition)
  /** Perspective orbit camera; consumes gestures instead of `zoomInstance`/`dragInstance` in 3D mode. */
  private camera = new Camera(this.store, this.config)
  /** Whether the 3D camera has been positioned (seeded on first entry into 3D mode). */
  private _isCameraInitialized = false

  private fpsMonitor: FPSMonitor | undefined

  private currentEvent: D3ZoomEvent<HTMLCanvasElement, undefined> | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | MouseEvent | undefined
  /**
   * The value of `_findHoveredItemExecutionCount` is incremented by 1 on each animation frame.
   * When the counter reaches MAX_HOVER_DETECTION_DELAY (default 4), it is reset to 0 and hover detection runs.
   */
  private _findHoveredItemExecutionCount = 0
  /**
   * If no pointer is over the Canvas, hover detection will not be executed.
   */
  private _isPointerOnCanvas = false
  /**
   * Last mouse position for detecting significant mouse movement
   */
  private _lastMouseX = 0
  private _lastMouseY = 0
  /**
   * Last checked mouse position for hover detection
   */
  private _lastCheckedMouseX = 0
  private _lastCheckedMouseY = 0
  /**
   * Force hover detection on next frame, bypassing mouse movement check.
   * Set when scene changes but mouse stays still (after simulation or zoom ends).
   */
  private _shouldForceHoverDetection = false
  /**
   * View transform the picking buffer was last validated against; a change
   * (zoom, orbit, resize) marks the buffer stale (see updatePickingBufferStaleness).
   */
  private _lastPickingMatrix: number[] = []
  /**
   * After setting data and render graph at a first time, the fit logic will run
   * */
  private _isFirstRenderAfterInit = true
  private _fitViewOnInitTimeoutID: number | undefined

  private isPointPositionsUpdateNeeded = false
  private isPointColorUpdateNeeded = false
  private isPointSizeUpdateNeeded = false
  private isPointShapeUpdateNeeded = false
  private isPointImageIndicesUpdateNeeded = false
  private isLinksUpdateNeeded = false
  private isLinkColorUpdateNeeded = false
  private isLinkWidthUpdateNeeded = false
  private isLinkArrowUpdateNeeded = false
  private isLinkStyleUpdateNeeded = false
  private isPointClusterUpdateNeeded = false
  private isForceManyBodyUpdateNeeded = false
  private isForceLinkUpdateNeeded = false
  private isForceCenterUpdateNeeded = false
  private isPointImageSizesUpdateNeeded = false

  // Whether the collision force's GPU resources (grid/size textures, programs)
  // are allocated and match the current data. Allocated lazily the first time
  // collision runs, so a graph that never enables it pays no memory cost.
  private isForceCollisionReady = false

  private _isDestroyed = false

  /**
   * Create a new Graph instance.
   * @param div - Container element for the graph canvas.
   * @param config - Optional configuration. Unset properties use default values.
   */
  public constructor (
    div: HTMLDivElement,
    config?: GraphConfig,
    devicePromise?: Promise<Device>
  ) {
    if (config) applyConfig(this.config, config)
    this.store.spaceDimensions = this.config.spaceDimensions

    if (devicePromise) {
      this.deviceInitPromise = devicePromise
      this.shouldDestroyDevice = false // External device - Graph does not own it
    } else {
      const canvas = document.createElement('canvas')
      this.deviceInitPromise = this.createDevice(canvas)
      this.shouldDestroyDevice = true // Graph created the device and owns it
    }

    const setupPromise = this.deviceInitPromise.then(device => {
      if (this._isDestroyed) {
        // Only destroy the device if Graph owns it
        if (this.shouldDestroyDevice) {
          device.destroy()
        }
        return device
      }
      this.device = device
      this.isReady = true
      const deviceCanvasContext = this.validateDevice(device)

      // If external device was provided, sync its useDevicePixels with config.pixelRatio
      if (devicePromise) {
        deviceCanvasContext.setProps({ useDevicePixels: this.config.pixelRatio })
      }

      this.store.div = div
      const deviceCanvas = deviceCanvasContext.canvas as HTMLCanvasElement
      // Ensure canvas is in the div
      if (deviceCanvas.parentNode !== this.store.div) {
        if (deviceCanvas.parentNode) {
          deviceCanvas.parentNode.removeChild(deviceCanvas)
        }
        this.store.div.appendChild(deviceCanvas)
      }
      this.addAttribution()
      deviceCanvas.style.width = '100%'
      deviceCanvas.style.height = '100%'
      this.canvas = deviceCanvas
      this.updateCanvasTouchAction()

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => { this.requestRender() })
        this.resizeObserver.observe(this.canvas)
      }

      // Animated camera moves (fitView tweens, setCameraState with a duration)
      // run on d3's own timer, outside the render loop — each tick schedules
      // one redraw here.
      this.camera.onUpdate = (): void => { this.requestRender() }

      const w = this.canvas.clientWidth
      const h = this.canvas.clientHeight

      this.store.adjustSpaceSize(this.config.spaceSize, this.device.limits.maxTextureDimension2D)
      this.store.setWebGLMaxTextureSize(this.device.limits.maxTextureDimension2D)
      this.store.updateScreenSize(w, h)
      // resizeCanvas() only reacts to size *changes*, so the camera's viewport
      // (projection aspect) must be seeded here for a graph created in 3D mode.
      if (this.store.is3D) this.camera.setViewport(w, h)

      this.canvasD3Selection = select<HTMLCanvasElement, undefined>(this.canvas)
        .on('pointerenter.cosmos', (event: PointerEvent) => {
          if (!event.isPrimary) return
          this._isPointerOnCanvas = true
          this._lastMouseX = event.clientX
          this._lastMouseY = event.clientY
          // Drain any hover work that accumulated while the pointer was away
          // (forced hover check or unchecked mouse movement).
          this.requestRender()
        })
        .on('pointermove.cosmos', (event: PointerEvent) => {
          if (!event.isPrimary) return
          this._isPointerOnCanvas = true
          this._lastMouseX = event.clientX
          this._lastMouseY = event.clientY
          this.currentEvent = event
          this.updateMousePosition(event)

          // Cancel a pending long-press if the finger drifted past the threshold —
          // the user is clearly panning/dragging, not holding to open a context menu.
          if (this._longPressTimerId !== undefined) {
            const dx = Math.abs(event.clientX - this._longPressStartX)
            const dy = Math.abs(event.clientY - this._longPressStartY)
            if (dx > LONG_PRESS_MOVE_THRESHOLD_PX || dy > LONG_PRESS_MOVE_THRESHOLD_PX) {
              this.cancelLongPress()
            }
          }

          this.config.onMouseMove?.(
            this.store.hoveredPoint?.index,
            this.store.hoveredPoint?.position,
            this.currentEvent
          )

          this.requestRender()
        })
        .on('pointerleave.cosmos pointercancel.cosmos', (event: PointerEvent) => {
          // Non-primary pointers (e.g. second finger of a pinch) leaving must not
          // flip _isPointerOnCanvas or clear hover — the primary pointer is still down.
          if (!event.isPrimary) return
          this.cancelLongPress()
          this._isPointerOnCanvas = false
          // Touch tap: pointerdown → pointerup → pointerleave → click
          // Clearing here would empty hoveredPoint before click reads it.
          // Keep it — the next tap overwrites it anyway.
          if (event.pointerType !== 'mouse') return
          this.currentEvent = event

          // Clear point hover state and trigger callback if needed
          if (this.store.hoveredPoint !== undefined && this.config.onPointMouseOut) {
            this.config.onPointMouseOut(event)
          }

          // Clear link hover state and trigger callback if needed
          if (this.store.hoveredLinkIndex !== undefined && this.config.onLinkMouseOut) {
            this.config.onLinkMouseOut(event)
          }

          // Clear hover states
          this.store.hoveredPoint = undefined
          this.store.hoveredLinkIndex = undefined
          // The hovered link was drawn wider in the index pass (hover
          // hysteresis) — clearing the hover invalidates that buffer.
          if (this.lines) this.lines.isLinkIndexBufferStale = true

          // Update cursor style after clearing hover states
          this.updateCanvasCursor()

          // Hover ring / link highlight was cleared — redraw without it
          this.requestRender()
        })
        .on('pointerdown.cosmos', (event: PointerEvent) => {
          if (!event.isPrimary) return
          this.currentEvent = event
          // A new gesture starts fresh — drop any stale suppress flag.
          this._shouldSuppressNextClick = false
          // Touch fires no pointermove before touchstart, so hoveredPoint is empty
          // when d3-drag checks it. Pick here so drag starts, not zoom.
          // updateMousePosition first — findHoveredItem reads what it writes.
          this._lastMouseX = event.clientX
          this._lastMouseY = event.clientY
          this.updateMousePosition(event)
          this.findHoveredItem(true)
          // The immediate pick may have shown/moved the hover ring
          this.requestRender()

          // Touch/pen long-press → contextmenu. The mouse path already gets
          // contextmenu from the browser; this fills the gap for touch where
          // long-press doesn't reliably dispatch contextmenu on canvas.
          if (event.pointerType !== 'mouse') {
            this._longPressStartX = event.clientX
            this._longPressStartY = event.clientY
            this.cancelLongPress()
            this._longPressTimerId = window.setTimeout(() => {
              this._longPressTimerId = undefined
              if (this._isDestroyed) return
              // Re-pick in case points moved during the hold (simulation may have
              // shifted them under the stationary finger).
              this.findHoveredItem(true)
              this.requestRender()
              this._shouldSuppressNextClick = true
              this.fireContextMenu(event)
            }, LONG_PRESS_DURATION_MS)
          }
        })
        .on('pointerup.cosmos', (event: PointerEvent) => {
          if (!event.isPrimary) return
          // Finger lifted before the long-press window expired — it's a tap.
          this.cancelLongPress()
        })
        .on('click.cosmos', this.onClick.bind(this))
        .on('contextmenu.cosmos', this.onContextMenu.bind(this))

      // The camera's gesture handlers need the selection to cancel the named
      // fit/setState transition when a user gesture takes over.
      this.camera.canvasSelection = this.canvasD3Selection

      // `document` is shared between Graph instances and d3 keeps one listener per
      // element+type+name — a per-instance namespace keeps a second instance from
      // clobbering the first, and destroy() from removing the survivors' listeners.
      select(document)
        .on(`keydown.${this.documentEventsNamespace}`, (event) => { if (event.code === 'Space') this.store.isSpaceKeyPressed = true })
        .on(`keyup.${this.documentEventsNamespace}`, (event) => { if (event.code === 'Space') this.store.isSpaceKeyPressed = false })

      this.zoomInstance.behavior
        .on('start.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
          this.currentEvent = e
          this.requestRender()
        })
        .on('zoom.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
          const userDriven = !!e.sourceEvent
          if (userDriven) this.updateMousePosition(e.sourceEvent)
          this.currentEvent = e
          this.requestRender()
        })
        .on('end.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
          this.currentEvent = e
          // Force hover detection on next frame since zoom may have changed what's under the mouse
          this._shouldForceHoverDetection = true
          this.requestRender()
        })

      // The 3D orbit camera consumes gestures through its own d3-zoom behavior;
      // mirror the 2D hooks so orbit/pan/dolly interaction drives rendering.
      this.camera.behavior
        .on('start.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
          this.currentEvent = e
          this.requestRender()
        })
        .on('zoom.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
          this.currentEvent = e
          this.requestRender()
        })
        .on('end.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
          this.currentEvent = e
          // The view changed — what's under the stationary cursor did too
          this._shouldForceHoverDetection = true
          this.requestRender()
        })

      this.dragInstance.behavior
        .on('start.detect', (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => {
          this.currentEvent = e
          this.updateCanvasCursor()
          this.requestRender()
        })
        .on('drag.detect', (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => {
          if (this.dragInstance.isActive) {
            this.updateMousePosition(e)
          }
          this.currentEvent = e
          this.requestRender()
        })
        .on('end.detect', (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => {
          this.currentEvent = e
          this.updateCanvasCursor()
          // The drag GPU write happens after the draw pass, so the final
          // position only becomes visible on the frame scheduled here.
          this.requestRender()
        })
      // Bind the gesture behaviors for the initial mode (2D pan/zoom + drag, or
      // the orbit camera in 3D), honoring the enableZoom/enableDrag flags.
      this.updateZoomDragBehaviors()
      // Zoom level 1 means no zoom (100% scale). defaultConfigValues.initialZoomLevel is undefined,
      // so we fall back to 1 here as the neutral zoom level when no initial zoom is configured.
      this.setZoomLevel(this.config.initialZoomLevel ?? 1)

      this.store.maxPointSize = getMaxPointSize(device, this.config.pixelRatio)

      // Initialize simulation state based on enableSimulation config
      // If simulation is disabled, start with isSimulationRunning = false
      this.store.isSimulationRunning = this.config.enableSimulation

      this.points = new Points(device, this.config, this.store, this.graph)
      this.points.transition = this.transition
      this.lines = new Lines(device, this.config, this.store, this.graph, this.points)
      if (this.config.enableSimulation) {
        this.forceGravity = new ForceGravity(device, this.config, this.store, this.graph, this.points)
        this.forceCenter = new ForceCenter(device, this.config, this.store, this.graph, this.points)
        this.forceManyBody = new ForceManyBody(device, this.config, this.store, this.graph, this.points)
        this.forceLinkIncoming = new ForceLink(device, this.config, this.store, this.graph, this.points)
        this.forceLinkOutgoing = new ForceLink(device, this.config, this.store, this.graph, this.points)
        this.forceCollision = new ForceCollision(device, this.config, this.store, this.graph, this.points)
      }
      this.clusters = new Clusters(device, this.config, this.store, this.graph, this.points)

      this.store.backgroundColor = getRgbaColor(this.config.backgroundColor)
      this.store.setHoveredPointRingColor(this.config.hoveredPointRingColor)
      this.store.setFocusedPointRingColor(this.config.focusedPointRingColor)
      if (this.config.focusedPointIndex !== undefined) {
        this.store.setFocusedPoint(this.config.focusedPointIndex)
      }
      this.store.setGreyoutPointColor(this.config.pointGreyoutColor)
      this.store.setOutlinedPointRingColor(this.config.outlinedPointRingColor)
      this.store.setHighlightedPointSet(this.config.highlightedPointIndices)
      this.store.setOutlinedPointSet(this.config.outlinedPointIndices)
      this.store.setHoveredLinkColor(this.config.hoveredLinkColor)

      this.store.updateLinkHoveringEnabled(this.config)

      if (this.config.showFPSMonitor) this.fpsMonitor = new FPSMonitor(this.canvas)

      if (this.config.randomSeed !== undefined) this.store.addRandomSeed(this.config.randomSeed)

      return device
    })
      .catch(error => {
        this.device = undefined
        this.isReady = false
        console.error('Device initialization failed:', error)
        throw error
      })

    this.ready = setupPromise.then(() => undefined)
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
   * The maximum point size.
   * This value is the maximum size of the `gl.POINTS` primitive that WebGL can render on the user's hardware.
   */
  public get maxPointSize (): number {
    if (this._isDestroyed) return 0
    return this.store.maxPointSize
  }

  /**
   * Whether the instance is currently rendering in 3D mode
   * (after `setPointPositions3D`; `setPointPositions` switches back to 2D).
   */
  public get is3D (): boolean {
    return this.store.is3D
  }

  /**
   * Apply a new configuration. Changes take effect immediately.
   *
   * **Important:** Every call fully resets the configuration to defaults first,
   * then applies the provided values on top. Properties not included in `config`
   * will revert to their default values — they are not preserved from the previous call.
   *
   * @param config - Configuration object. Only include the properties you want to set.
   */
  public setConfig (config: GraphConfig): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setConfig(config))) return
    const prevConfig = { ...this.config }
    resetConfigToDefaults(this.config)
    applyConfig(this.config, config)
    // The rendering mode is sticky: a full config reset must not silently flip
    // an app out of 3D — only an explicit `spaceDimensions` value changes it.
    if (config.spaceDimensions === undefined) this.config.spaceDimensions = prevConfig.spaceDimensions
    this.preserveInitOnlyFields(prevConfig)
    this.updateStateFromConfig(prevConfig)
  }

  /**
   * Partially updates the graph configuration. Only the provided properties
   * will be changed; all other properties retain their current values.
   *
   * Properties set to `undefined` will be reset to their default values.
   *
   * @param config - A partial configuration object with the properties to update.
   */
  public setConfigPartial (config: GraphConfig): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setConfigPartial(config))) return
    const prevConfig = { ...this.config }
    applyConfig(this.config, config, true)
    this.preserveInitOnlyFields(prevConfig)
    this.updateStateFromConfig(prevConfig)
  }

  /**
   * Sets the positions for the graph points.
   *
   * The data dimensionality is independent of the rendering mode — control the
   * view with the `spaceDimensions` configuration property. 2D positions viewed
   * in 3D lie in the `z = 0` plane; 3D positions viewed in 2D are projected
   * top-down (their z is preserved).
   *
   * @param {Float32Array} pointPositions - A Float32Array of point coordinates:
   * `[x1, y1, x2, y2, ...]` with `options.dimensions: 2` (default), or
   * `[x1, y1, z1, x2, y2, z2, ...]` with `options.dimensions: 3`.
   * @param {Object | boolean} [options] - Options object:
   *   - `dimensions` (2 | 3): Coordinates per point in `pointPositions` (`2` by default).
   *   - `dontRescale` (boolean): For this call only, don't rescale the points into the
   *     `[0, spaceSize]` space. When `false`/`undefined`, `config.rescalePositions` decides.
   *
   *   Passing a boolean is deprecated shorthand for `{ dontRescale }`.
   * @note If `transitionDuration > 0` and the simulation is running, the simulation is automatically
   * paused for the transition and remains paused afterwards. Call `unpause()` to resume it.
   * When switching data from 2D to 3D, z animates from `0`.
   */
  public setPointPositions (pointPositions: Float32Array, options?: { dimensions?: 2 | 3; dontRescale?: boolean } | boolean): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setPointPositions(pointPositions, options))) return
    const { dimensions = 2, dontRescale } =
      typeof options === 'boolean' ? { dimensions: 2 as const, dontRescale: options } : options ?? {}
    let positions = pointPositions
    if (positions.length % dimensions !== 0) {
      console.warn(`cosmos.gl: \`setPointPositions\` expects ${dimensions} coordinates per point; truncating the incomplete trailing point`)
      positions = positions.subarray(0, positions.length - positions.length % dimensions)
    }
    this.graph.inputPointPositions = positions
    this.graph.inputPointDimensions = dimensions
    this.points!.shouldSkipRescale = dontRescale
    this.markPointPositionsDirty()
    this.maybeInitializeCamera()
  }

  /**
   * Sets 3D positions for the graph points and switches the instance into 3D rendering mode.
   *
   * @deprecated Use `setPointPositions(positions, { dimensions: 3 })` with the
   * `spaceDimensions: 3` configuration property instead. Note that unlike this
   * method's legacy behavior, `setPointPositions` never changes the rendering
   * mode — switch back to 2D with `setConfigPartial({ spaceDimensions: 2 })`.
   *
   * @param {Float32Array} pointPositions - A Float32Array of `[x1, y1, z1, x2, y2, z2, ...]` point coordinates.
   * @param {boolean} [dontRescale] - When `true`, skips the one-time rescaling of the provided
   * positions into the `[0, spaceSize]` cube.
   */
  public setPointPositions3D (pointPositions: Float32Array, dontRescale?: boolean | undefined): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setPointPositions3D(pointPositions, dontRescale))) return
    // Legacy behavior: the 3D data setter also switches the view into 3D.
    this.config.spaceDimensions = 3
    this.setSpaceDimensions(3)
    this.setPointPositions(pointPositions, { dimensions: 3, dontRescale })
  }

  /**
   * Sets the colors for the graph points.
   *
   * @param {Float32Array} pointColors - A Float32Array representing the colors of points in the format [r1, g1, b1, a1, r2, g2, b2, a2, ..., rn, gn, bn, an],
   * where each color is represented in RGBA format.
   * Example: `new Float32Array([1, 0, 0, 1, 0, 1, 0, 1])` sets the first point to red and the second point to green.
  */
  public setPointColors (pointColors: Float32Array): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setPointColors(pointColors))) return
    this.graph.inputPointColors = pointColors
    this.isPointColorUpdateNeeded = true
    this.transition.queue(TransitionProperty.PointColors)
  }

  /**
   * Gets the current colors of the graph points.
   *
   * @returns {Float32Array} A Float32Array representing the colors of points in the format [r1, g1, b1, a1, r2, g2, b2, a2, ..., rn, gn, bn, an],
   * where each color is in RGBA format. Returns an empty Float32Array if no point colors are set.
   */
  public getPointColors (): Float32Array {
    if (this._isDestroyed) return new Float32Array()
    return this.graph.pointColors ?? new Float32Array()
  }

  /**
   * Sets the sizes for the graph points.
   *
   * @param {Float32Array} pointSizes - A Float32Array representing the sizes of points in the format [size1, size2, ..., sizen],
   * where `n` is the index of the point.
   * Example: `new Float32Array([10, 20, 30])` sets the first point to size 10, the second point to size 20, and the third point to size 30.
   */
  public setPointSizes (pointSizes: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointSizes(pointSizes))) return
    this.graph.inputPointSizes = pointSizes
    this.isPointSizeUpdateNeeded = true
    this.transition.queue(TransitionProperty.PointSizes)
  }

  /**
   * Sets the shapes for the graph points.
   *
   * @param {Float32Array} pointShapes - A Float32Array representing the shapes of points in the format [shape1, shape2, ..., shapen],
   * where `n` is the index of the point and each shape value corresponds to a PointShape enum:
   * 0 = Circle, 1 = Square, 2 = Triangle, 3 = Diamond, 4 = Pentagon, 5 = Hexagon, 6 = Star, 7 = Cross, 8 = None.
   * Example: `new Float32Array([0, 1, 2])` sets the first point to Circle, the second point to Square, and the third point to Triangle.
   * Images are rendered above shapes.
   */
  public setPointShapes (pointShapes: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointShapes(pointShapes))) return
    this.graph.inputPointShapes = pointShapes
    this.isPointShapeUpdateNeeded = true
  }

  /**
   * Sets the images for the graph points using ImageData objects.
   * Images are rendered above shapes.
   * To use images, provide image indices via setPointImageIndices().
   *
   * @param {ImageData[]} imageDataArray - Array of ImageData objects to use as point images.
   * Example: `setImageData([imageData1, imageData2, imageData3])`
   */
  public setImageData (imageDataArray: ImageData[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setImageData(imageDataArray))) return
    this.graph.inputImageData = imageDataArray
    this.points?.createAtlas()
    this.requestRender()
  }

  /**
   * Sets which image each point should use from the images array.
   * Images are rendered above shapes.
   *
   * @param {Float32Array} imageIndices - A Float32Array representing which image each point uses in the format [index1, index2, ..., indexn],
   * where `n` is the index of the point and each value is an index into the images array provided to `setImageData`.
   * Example: `new Float32Array([0, 1, 0])` sets the first point to use image 0, second point to use image 1, third point to use image 0.
   */
  public setPointImageIndices (imageIndices: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointImageIndices(imageIndices))) return
    this.graph.inputPointImageIndices = imageIndices
    this.isPointImageIndicesUpdateNeeded = true
  }

  /**
   * Sets the sizes for the point images.
   *
   * @param {Float32Array} imageSizes - A Float32Array representing the sizes of point images in the format [size1, size2, ..., sizen],
   * where `n` is the index of the point.
   * Example: `new Float32Array([10, 20, 30])` sets the first image to size 10, the second image to size 20, and the third image to size 30.
   */
  public setPointImageSizes (imageSizes: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointImageSizes(imageSizes))) return
    this.graph.inputPointImageSizes = imageSizes
    this.isPointImageSizesUpdateNeeded = true
  }

  /**
   * Gets the current sizes of the graph points.
   *
   * @returns {Float32Array} A Float32Array representing the sizes of points in the format [size1, size2, ..., sizen],
   * where `n` is the index of the point. Returns an empty Float32Array if no point sizes are set.
   */
  public getPointSizes (): Float32Array {
    if (this._isDestroyed) return new Float32Array()
    return this.graph.pointSizes ?? new Float32Array()
  }

  /**
   * Sets the links for the graph.
   *
   * @param {Float32Array} links - A Float32Array representing the links between points
   * in the format [source1, target1, source2, target2, ..., sourcen, targetn],
   * where `source` and `target` are the indices of the points being linked.
   * Example: `new Float32Array([0, 1, 1, 2])` creates a link from point 0 to point 1 and another link from point 1 to point 2.
   */
  public setLinks (links: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinks(links))) return
    let sanitizedLinks = links
    if (sanitizedLinks.length % 2 !== 0) {
      console.warn('cosmos.gl: `setLinks` expects 2 point indices per link; truncating the incomplete trailing link')
      sanitizedLinks = sanitizedLinks.subarray(0, sanitizedLinks.length - 1)
    }
    this.graph.inputLinks = sanitizedLinks
    this.isLinksUpdateNeeded = true
    // Links related texture depends on links length, so we need to update it
    this.isLinkColorUpdateNeeded = true
    this.isLinkWidthUpdateNeeded = true
    this.isLinkArrowUpdateNeeded = true
    this.isLinkStyleUpdateNeeded = true
    this.isForceLinkUpdateNeeded = true
  }

  /**
   * Sets the colors for the graph links.
   *
   * @param {Float32Array} linkColors - A Float32Array representing the colors of links in the format [r1, g1, b1, a1, r2, g2, b2, a2, ..., rn, gn, bn, an],
   * where each color is in RGBA format.
   * Example: `new Float32Array([1, 0, 0, 1, 0, 1, 0, 1])` sets the first link to red and the second link to green.
   */
  public setLinkColors (linkColors: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinkColors(linkColors))) return
    this.graph.inputLinkColors = linkColors
    this.isLinkColorUpdateNeeded = true
    this.transition.queue(TransitionProperty.LinkColors)
  }

  /**
   * Gets the current colors of the graph links.
   *
   * @returns {Float32Array} A Float32Array representing the colors of links in the format [r1, g1, b1, a1, r2, g2, b2, a2, ..., rn, gn, bn, an],
   * where each color is in RGBA format. Returns an empty Float32Array if no link colors are set.
   */
  public getLinkColors (): Float32Array {
    if (this._isDestroyed) return new Float32Array()
    return this.graph.linkColors ?? new Float32Array()
  }

  /**
   * Sets the widths for the graph links.
   *
   * @param {Float32Array} linkWidths - A Float32Array representing the widths of links in the format [width1, width2, ..., widthn],
   * where `n` is the index of the link.
   * Example: `new Float32Array([1, 2, 3])` sets the first link to width 1, the second link to width 2, and the third link to width 3.
   */
  public setLinkWidths (linkWidths: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinkWidths(linkWidths))) return
    this.graph.inputLinkWidths = linkWidths
    this.isLinkWidthUpdateNeeded = true
    this.transition.queue(TransitionProperty.LinkWidths)
  }

  /**
   * Gets the current widths of the graph links.
   *
   * @returns {Float32Array} A Float32Array representing the widths of links in the format [width1, width2, ..., widthn],
   * where `n` is the index of the link. Returns an empty Float32Array if no link widths are set.
   */
  public getLinkWidths (): Float32Array {
    if (this._isDestroyed) return new Float32Array()
    return this.graph.linkWidths ?? new Float32Array()
  }

  /**
   * Sets the arrows for the graph links.
   *
   * @param {boolean[]} linkArrows - An array of booleans indicating whether each link should have an arrow,
   * in the format [arrow1, arrow2, ..., arrown], where `n` is the index of the link.
   * Example: `[true, false, true]` sets arrows on the first and third links, but not on the second link.
   */
  public setLinkArrows (linkArrows: boolean[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinkArrows(linkArrows))) return
    this.graph.linkArrowsBoolean = linkArrows
    this.isLinkArrowUpdateNeeded = true
  }

  /**
   * Sets the styles (stroke patterns) for the graph links.
   *
   * @param {Float32Array} linkStyles - A Float32Array representing the style of each link in the format [style1, style2, ..., stylen],
   * where `n` is the index of the link. Each value is a `LinkStyle` enum value: `0` = Solid, `1` = Dashed, `2` = Dotted.
   * Example: `new Float32Array([0, 1, 2])` sets the first link to solid, the second to dashed, and the third to dotted.
   * Invalid values fall back to the `linkDefaultStyle` config value.
   * Dash length and gap are controlled globally via the `linkDashLength` and `linkDashGap` config options.
   */
  public setLinkStyles (linkStyles: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinkStyles(linkStyles))) return
    this.graph.inputLinkStyles = linkStyles
    this.isLinkStyleUpdateNeeded = true
  }

  /**
   * Gets the current styles of the graph links.
   *
   * @returns {Float32Array} A Float32Array representing the style of each link in the format [style1, style2, ..., stylen],
   * where `n` is the index of the link. Returns an empty Float32Array if no link styles are set.
   */
  public getLinkStyles (): Float32Array {
    if (this._isDestroyed) return new Float32Array()
    return this.graph.linkStyles ?? new Float32Array()
  }

  /**
   * Sets the strength for the graph links.
   *
   * @param {Float32Array} linkStrength - A Float32Array representing the strength of each link in the format [strength1, strength2, ..., strengthn],
   * where `n` is the index of the link.
   * Example: `new Float32Array([1, 2, 3])` sets the first link to strength 1, the second link to strength 2, and the third link to strength 3.
   */
  public setLinkStrength (linkStrength: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinkStrength(linkStrength))) return
    this.graph.inputLinkStrength = linkStrength
    this.isForceLinkUpdateNeeded = true
  }

  /**
   * Sets the point clusters for the graph.
   *
   * @param {(number | undefined)[]} pointClusters - Array of cluster indices for each point in the graph.
   *   - Index: Each index corresponds to a point.
   *   - Values: Integers starting from 0; `undefined` indicates that a point does not belong to any cluster and will not be affected by cluster forces.
   * @example
   *   `[0, 1, 0, 2, undefined, 1]` maps points to clusters: point 0 and 2 to cluster 0, point 1 to cluster 1, and point 3 to cluster 2.
   * Points 4 is unclustered.
   * @note Clusters without specified positions via `setClusterPositions` will be positioned at their centermass by default.
   */
  public setPointClusters (pointClusters: (number | undefined)[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointClusters(pointClusters))) return
    this.graph.inputPointClusters = pointClusters
    this.isPointClusterUpdateNeeded = true
  }

  /**
   * Sets the positions of the point clusters for the graph.
   *
   * @param {(number | undefined)[]} clusterPositions - Array of cluster positions.
   *   - Every two elements represent the x and y coordinates for a cluster position.
   *   - `undefined` means the cluster's position is not defined and will use centermass positioning instead.
   * @example
   *   `[10, 20, 30, 40, undefined, undefined]` places the first cluster at (10, 20) and the second at (30, 40);
   * the third cluster will be positioned at its centermass automatically.
   * @note In 3D mode these positions pin only x and y; z follows the cluster's centermass.
   * Use `setClusterPositions3D` to pin all three coordinates.
   */
  public setClusterPositions (clusterPositions: (number | undefined)[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setClusterPositions(clusterPositions))) return
    this.graph.inputClusterPositions = clusterPositions
    this.graph.inputClusterPositionsDimensions = 2
    this.isPointClusterUpdateNeeded = true
  }

  /**
   * Sets the 3D positions of the point clusters for the graph.
   *
   * @param {(number | undefined)[]} clusterPositions - Array of cluster positions.
   *   - Every three elements represent the x, y and z coordinates for a cluster position.
   *   - `undefined` means the coordinate is not defined: a cluster with undefined x or y
   *     uses centermass positioning entirely; an undefined z pins only x and y while z
   *     follows the cluster's centermass.
   * @example
   *   `[10, 20, 30, undefined, undefined, undefined]` places the first cluster at (10, 20, 30);
   * the second cluster will be positioned at its centermass automatically.
   * @note In 2D mode the z coordinates are ignored.
   */
  public setClusterPositions3D (clusterPositions: (number | undefined)[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setClusterPositions3D(clusterPositions))) return
    this.graph.inputClusterPositions = clusterPositions
    this.graph.inputClusterPositionsDimensions = 3
    this.isPointClusterUpdateNeeded = true
  }

  /**
   * Sets the force strength coefficients for clustering points in the graph.
   *
   * This method allows you to customize the forces acting on individual points during the clustering process.
   * The force coefficients determine the strength of the forces applied to each point.
   *
   * @param {Float32Array} clusterStrength - A Float32Array of force strength coefficients for each point in the format [coeff1, coeff2, ..., coeffn],
   * where `n` is the index of the point.
   * Example: `new Float32Array([1, 0.4, 0.3])` sets the force coefficient for point 0 to 1, point 1 to 0.4, and point 2 to 0.3.
   */
  public setPointClusterStrength (clusterStrength: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPointClusterStrength(clusterStrength))) return
    this.graph.inputClusterStrength = clusterStrength
    this.isPointClusterUpdateNeeded = true
  }

  /**
   * Sets which points are pinned (fixed) in position.
   *
   * Pinned points:
   * - Do not move due to physics forces (gravity, repulsion, link forces, etc.)
   * - Still participate in force calculations (other nodes are attracted to/repelled by them)
   * - Can still be dragged by the user if `enableDrag` is true
   *
   * @param {number[] | null} pinnedIndices - Array of point indices to pin. Set to `[]` or `null` to unpin all points.
   * @example
   *   // Pin points 0 and 5
   *   graph.setPinnedPoints([0, 5])
   *
   *   // Unpin all points
   *   graph.setPinnedPoints([])
   *   graph.setPinnedPoints(null)
   */
  public setPinnedPoints (pinnedIndices: number[] | null): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setPinnedPoints(pinnedIndices))) return
    this.graph.inputPinnedPoints = pinnedIndices && pinnedIndices.length > 0 ? pinnedIndices : undefined
    this.points?.updatePinnedStatus()
    this.requestRender()
  }

  /**
   * Renders the graph and starts rendering.
   * Does NOT modify simulation state - use start(), stop(), pause(), unpause() to control simulation.
   *
   * @param {number} [simulationAlpha] - Optional alpha value to set.
   *   - If 0: Sets alpha to 0, simulation stops after one frame (graph becomes static).
   *   - If positive: Sets alpha to that value.
   *   - If undefined: Keeps current alpha value.
   */
  public render (simulationAlpha?: number): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.render(simulationAlpha))) return
    this.graph.update()
    const { fitViewOnInit, fitViewDelay, fitViewPadding, fitViewDuration, fitViewByPointsInRect, fitViewByPointIndices, initialZoomLevel } = this.config
    if (!this.graph.pointsNumber && !this.graph.linksNumber) {
      this.stopFrames()
      select(this.canvas).style('cursor', null)
      if (this.device) {
        const clearPass = this.device.beginRenderPass({
          clearColor: this.store.backgroundColor,
          clearDepth: 1,
          clearStencil: 0,
        })
        clearPass.end()
        this.device.submit()
      }
      return
    }

    // If `initialZoomLevel` is set, we don't need to fit the view
    if (this._isFirstRenderAfterInit && fitViewOnInit && initialZoomLevel === undefined) {
      this._fitViewOnInitTimeoutID = window.setTimeout(() => {
        if (fitViewByPointIndices) this.fitViewByPointIndices(fitViewByPointIndices, fitViewDuration, fitViewPadding)
        else if (fitViewByPointsInRect && !this.store.is3D) {
          // `fitViewByPointsInRect` is a 2D-space rectangle; in 3D fall through to a full fit.
          this.setZoomTransformByPointPositions(
            new Float32Array(this.flatten(fitViewByPointsInRect)),
            fitViewDuration,
            undefined,
            fitViewPadding
          )
        } else this.fitView(fitViewDuration, fitViewPadding)
      }, fitViewDelay)
    }
    // Update graph and start frames
    this.update(simulationAlpha)

    // Position transitions must not compete with live force updates — pause the simulation
    // so physics and GPU interpolation don't fight over the same coordinates.
    // The simulation is intentionally left paused after the transition ends: calling
    // setPointPositions() implies the user wants to explore a specific layout, not have
    // forces immediately pull nodes away from it. Call unpause() to resume explicitly.
    // Color/size transitions are independent of physics and must not pause the simulation.
    if (this.transition.isPendingFor(TransitionProperty.Positions) &&
        this.store.isSimulationRunning &&
        this.config.transitionDuration > 0 &&
        !this._isFirstRenderAfterInit) {
      this.store.isSimulationRunning = false
      this.config.onSimulationPause?.()
    }

    const currentPositionTexture = this.points?.currentPositionTexture
    if (this.transition.isPending && (!currentPositionTexture || currentPositionTexture.destroyed)) {
      this.transition.abort()
    }

    this.transition.start()
    // Re-detect hover on the next frame since data may have changed under a stationary mouse
    this._shouldForceHoverDetection = true
    this.requestRender()

    this._isFirstRenderAfterInit = false
  }

  /**
   * Center the view on a point and zoom in, by point index.
   * @param index The index of the point in the array of points.
   * @param duration Duration of the animation transition in milliseconds (`700` by default).
   * @param scale Scale value to zoom in or out (`3` by default).
   * @param canZoomOut Set to `false` to prevent zooming out from the point (`true` by default).
   * @param enableSimulation Whether to run the simulation during the zoom transition (`true` by default).
   */
  public zoomToPointByIndex (index: number, duration = 700, scale = 3, canZoomOut = true, enableSimulation = true): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.zoomToPointByIndex(index, duration, scale, canZoomOut, enableSimulation))) return
    if (this.warnIf3D('zoomToPointByIndex')) return
    if (!this.device || !this.points || !this.canvasD3Selection) return
    const { store: { screenSize } } = this
    const positionPixels = readPixels(this.device, this.points.currentPositionFbo as Framebuffer)
    if (index === undefined) return
    const posX = positionPixels[index * 4 + 0]
    const posY = positionPixels[index * 4 + 1]
    if (posX === undefined || posY === undefined) return
    const distance = this.zoomInstance.getDistanceToPoint([posX, posY])
    const zoomLevel = canZoomOut ? scale : Math.max(this.getZoomLevel(), scale)
    if (distance < Math.min(screenSize[0], screenSize[1])) {
      this.setZoomTransformByPointPositions(new Float32Array([posX, posY]), duration, zoomLevel, undefined, enableSimulation)
    } else {
      // Override the config's `enableSimulationDuringZoom` for this programmatic zoom transition.
      this.zoomInstance.shouldEnableSimulationDuringZoomOverride = enableSimulation
      const transform = this.zoomInstance.getTransform([posX, posY], zoomLevel)
      const middle = this.zoomInstance.getMiddlePointTransform([posX, posY])
      this.canvasD3Selection
        .transition()
        .ease(easeQuadIn)
        .duration(duration / 2)
        .call(this.zoomInstance.behavior.transform, middle)
        .transition()
        .ease(easeQuadOut)
        .duration(duration / 2)
        .call(this.zoomInstance.behavior.transform, transform)
    }
  }

  /**
   * Zoom the view in or out to the specified zoom level.
   * @param value Zoom level
   * @param duration Duration of the zoom in/out transition.
   * @param enableSimulation Whether to run the simulation during the zoom transition (`true` by default).
   */

  public zoom (value: number, duration = 0, enableSimulation = true): void {
    if (this._isDestroyed) return
    this.setZoomLevel(value, duration, enableSimulation)
  }

  /**
   * Zoom the view in or out to the specified zoom level.
   * @param value Zoom level
   * @param duration Duration of the zoom in/out transition.
   * @param enableSimulation Whether to run the simulation during the zoom transition (`true` by default).
   */
  public setZoomLevel (value: number, duration = 0, enableSimulation = true): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setZoomLevel(value, duration, enableSimulation))) return

    if (this.warnIf3D('setZoomLevel')) return
    if (!this.canvasD3Selection) return

    // Override the config's `enableSimulationDuringZoom` for this programmatic zoom transition.
    this.zoomInstance.shouldEnableSimulationDuringZoomOverride = enableSimulation
    if (duration === 0) {
      this.canvasD3Selection
        .call(this.zoomInstance.behavior.scaleTo, value)
    } else {
      this.canvasD3Selection
        .transition()
        .duration(duration)
        .call(this.zoomInstance.behavior.scaleTo, value)
    }
  }

  /**
   * Get zoom level.
   * @returns Zoom level value of the view.
   */
  public getZoomLevel (): number {
    if (this._isDestroyed) return 0
    if (this.warnIf3D('getZoomLevel')) return 0
    return this.zoomInstance.eventTransform.k
  }

  /**
   * Get current X and Y coordinates of the points.
   * @returns Array of point positions.
   */
  public getPointPositions (): number[] {
    if (this._isDestroyed || !this.device || !this.points) return []
    if (this.graph.pointsNumber === undefined) return []
    const positions: number[] = []
    const pointPositionsPixels = readPixels(this.device, this.points.currentPositionFbo as Framebuffer)
    positions.length = this.graph.pointsNumber * 2
    for (let i = 0; i < this.graph.pointsNumber; i += 1) {
      const posX = pointPositionsPixels[i * 4 + 0]
      const posY = pointPositionsPixels[i * 4 + 1]
      if (posX !== undefined && posY !== undefined) {
        positions[i * 2] = posX
        positions[i * 2 + 1] = posY
      }
    }
    return positions
  }

  /**
   * Get current X, Y and Z coordinates of the points.
   * @returns Array of point positions in the format [x1, y1, z1, x2, y2, z2, ..., xn, yn, zn].
   * Z is `0` in 2D mode.
   */
  public getPointPositions3D (): number[] {
    if (this._isDestroyed || !this.device || !this.points) return []
    if (this.graph.pointsNumber === undefined) return []
    const positions: number[] = []
    const pointPositionsPixels = readPixels(this.device, this.points.currentPositionFbo as Framebuffer)
    positions.length = this.graph.pointsNumber * 3
    for (let i = 0; i < this.graph.pointsNumber; i += 1) {
      const posX = pointPositionsPixels[i * 4 + 0]
      const posY = pointPositionsPixels[i * 4 + 1]
      const posZ = pointPositionsPixels[i * 4 + 3]
      if (posX !== undefined && posY !== undefined) {
        positions[i * 3] = posX
        positions[i * 3 + 1] = posY
        positions[i * 3 + 2] = posZ ?? 0
      }
    }
    return positions
  }

  /**
   * Get current X and Y coordinates of the clusters.
   * @returns Array of cluster positions in `[x0, y0, x1, y1, ...]` order. Do not mutate the returned array.
   */
  public getClusterPositions (): Readonly<number[]> {
    if (this._isDestroyed || !this.device || !this.clusters) return []
    if (this.graph.pointClusters === undefined || this.clusters.clusterCount === undefined) return []
    return this.clusters.getCentroidPositions()
  }

  /**
   * Get current X, Y and Z coordinates of the clusters.
   * @returns Array of cluster positions in `[x0, y0, z0, x1, y1, z1, ...]` order
   * (z is `0` in 2D mode). Do not mutate the returned array.
   */
  public getClusterPositions3D (): Readonly<number[]> {
    if (this._isDestroyed || !this.device || !this.clusters) return []
    if (this.graph.pointClusters === undefined || this.clusters.clusterCount === undefined) return []
    return this.clusters.getCentroidPositions3D()
  }

  /**
   * Center and zoom in/out the view to fit all points in the scene.
   * In 3D mode the camera frames the bounding sphere of the points instead
   * (`enableSimulation` has no effect there).
   * @param duration Duration of the center and zoom in/out animation in milliseconds (`250` by default).
   * @param padding Padding around the viewport in percentage (`0.1` by default).
   * @param enableSimulation Whether to run the simulation during the zoom transition (`true` by default).
   */
  public fitView (duration = 250, padding = 0.1, enableSimulation = true): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.fitView(duration, padding, enableSimulation))) return
    if (this.store.is3D) {
      if (this.canvasD3Selection) {
        this.camera.fitToPositions(this.canvasD3Selection, this.getFitViewPositions3D(), 3, padding, duration)
        // Instant fits change the matrices with no tween tick to schedule a redraw
        this.requestRender()
      }
      return
    }
    this.setZoomTransformByPointPositions(this.getFitViewPositions(), duration, undefined, padding, enableSimulation)
  }

  /**
   * Center and zoom in/out the view to fit points by their indices in the scene.
   * @param indices Point indices to fit in the view.
   * @param duration Duration of the center and zoom in/out animation in milliseconds (`250` by default).
   * @param padding Padding around the viewport in percentage (`0.1` by default).
   * @param enableSimulation Whether to run the simulation during the zoom transition (`true` by default).
   */
  public fitViewByPointIndices (indices: number[], duration = 250, padding = 0.1, enableSimulation = true): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.fitViewByPointIndices(indices, duration, padding, enableSimulation))) return
    if (this.store.is3D) {
      const positionsArray3D = this.getFitViewPositions3D()
      const positions3D = new Float32Array(indices.length * 3)
      for (const [i, index] of indices.entries()) {
        positions3D[i * 3] = positionsArray3D[index * 3] as number
        positions3D[i * 3 + 1] = positionsArray3D[index * 3 + 1] as number
        positions3D[i * 3 + 2] = positionsArray3D[index * 3 + 2] as number
      }
      if (this.canvasD3Selection) {
        this.camera.fitToPositions(this.canvasD3Selection, positions3D, 3, padding, duration)
        this.requestRender()
      }
      return
    }
    const positionsArray = this.getFitViewPositions()
    const positions = new Float32Array(indices.length * 2)
    for (const [i, index] of indices.entries()) {
      positions[i * 2] = positionsArray[index * 2] as number
      positions[i * 2 + 1] = positionsArray[index * 2 + 1] as number
    }
    this.setZoomTransformByPointPositions(positions, duration, undefined, padding, enableSimulation)
  }

  /**
   * Center and zoom in/out the view to fit points by their positions in the scene.
   * @param positions Flat array of point coordinates as `[x0, y0, x1, y1, ...]`
   * (`[x0, y0, z0, x1, y1, z1, ...]` in 3D mode).
   * @param duration Duration of the center and zoom in/out animation in milliseconds (`250` by default).
   * @param padding Padding around the viewport in percentage (`0.1` by default).
   * @param enableSimulation Whether to run the simulation during the zoom transition (`true` by default).
   */
  public fitViewByPointPositions (positions: number[], duration = 250, padding = 0.1, enableSimulation = true): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.fitViewByPointPositions(positions, duration, padding, enableSimulation))) return

    if (this.store.is3D) {
      if (this.canvasD3Selection) {
        this.camera.fitToPositions(this.canvasD3Selection, positions, 3, padding, duration)
        this.requestRender()
      }
      return
    }
    this.setZoomTransformByPointPositions(new Float32Array(positions), duration, undefined, padding, enableSimulation)
  }

  /**
   * Sets the zoom transform so that the given point positions fit in the viewport, with optional animation.
   *
   * @param positions Flat array of point coordinates as `[x0, y0, x1, y1, ...]`.
   * @param duration Animation duration in milliseconds. Default `250`.
   * @param scale Optional scale factor; if omitted, scale is chosen to fit the positions.
   * @param padding Padding around the viewport as a fraction (e.g. `0.1` = 10%). Default `0.1`.
   * @param enableSimulation Whether to run the simulation during the zoom transition (`true` by default).
   */
  public setZoomTransformByPointPositions (positions: Float32Array, duration = 250, scale?: number, padding = 0.1, enableSimulation = true): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setZoomTransformByPointPositions(positions, duration, scale, padding, enableSimulation))) return
    if (this.warnIf3D('setZoomTransformByPointPositions', 'use `fitViewByPointPositions` instead')) return

    // Override the config's `enableSimulationDuringZoom` for this programmatic zoom transition.
    this.zoomInstance.shouldEnableSimulationDuringZoomOverride = enableSimulation
    this.resizeCanvas()
    const transform = this.zoomInstance.getTransform(positions, scale, padding)
    if (duration <= 0) {
      // Apply synchronously — a zero-duration d3 transition still needs a timer
      // tick, which never comes in a hidden/background tab (mirrors the 3D
      // camera's synchronous duration-0 fit).
      this.canvasD3Selection?.call(this.zoomInstance.behavior.transform, transform)
    } else {
      this.canvasD3Selection
        ?.transition()
        .ease(easeQuadInOut)
        .duration(duration)
        .call(this.zoomInstance.behavior.transform, transform)
    }
  }

  /**
   * Find point indices inside a rectangular area.
   *
   * **Important:** This method is synchronous and must only be called when the graph is ready.
   * Ensure `await graph.ready` has resolved (or use the result inside `graph.ready.then(...)`) before
   * calling. If called before initialization completes, returns an empty array.
   *
   * @param rect - Array of two corner points `[[left, top], [right, bottom]]`.
   * The coordinates should be from 0 to the width/height of the canvas.
   * @returns Array of point indices inside the rectangle.
   */
  public findPointsInRect (rect: [[number, number], [number, number]]): number[] {
    if (this._isDestroyed) return []
    if (this.warnIf3D('findPointsInRect')) return []
    if (!this.isReady || !this.device || !this.points) return []

    const h = this.store.screenSize[1]
    this.store.searchArea = [[rect[0][0], (h - rect[1][1])], [rect[1][0], (h - rect[0][1])]]
    if (!this.points.findPointsInRect()) return []
    const pointsNumber = this.graph.pointsNumber ?? 0
    return extractIndicesFromPixels(readPixels(this.device, this.points.searchFbo as Framebuffer))
      .filter(index => index < pointsNumber)
  }

  /**
   * Find point indices inside a polygon area.
   *
   * **Important:** This method is synchronous and must only be called when the graph is ready.
   * Ensure `await graph.ready` has resolved (or use the result inside `graph.ready.then(...)`) before
   * calling. If called before initialization completes, returns an empty array.
   *
   * @param polygonPath - Array of points `[[x1, y1], [x2, y2], ..., [xn, yn]]` that defines the polygon.
   * The coordinates should be from 0 to the width/height of the canvas.
   * @returns Array of point indices inside the polygon.
   */
  public findPointsInPolygon (polygonPath: [number, number][]): number[] {
    if (this._isDestroyed) return []
    if (this.warnIf3D('findPointsInPolygon')) return []
    if (!this.isReady || !this.device || !this.points) return []

    if (polygonPath.length < 3) {
      console.warn('Polygon path requires at least 3 points to form a polygon.')
      return []
    }

    const h = this.store.screenSize[1]
    const convertedPath = polygonPath.map(([x, y]) => [x, h - y] as [number, number])
    this.points.updatePolygonPath(convertedPath)
    if (!this.points.findPointsInPolygon()) return []
    const pointsNumber = this.graph.pointsNumber ?? 0
    return extractIndicesFromPixels(readPixels(this.device, this.points.searchFbo as Framebuffer))
      .filter(index => index < pointsNumber)
  }

  /**
   * Get point indices that are neighbors of the given point(s) — connected by a link in either direction.
   * @param pointIndices A single point index or an array of point indices.
   * @returns Deduplicated array of neighboring point indices.
   */
  public getNeighboringPointIndices (pointIndices: number | number[]): number[] {
    if (this._isDestroyed) return []
    return this.graph.getNeighboringPointIndices(pointIndices)
  }

  /**
   * Get link indices where both endpoints are within the given point(s).
   * @param pointIndices A single point index or an array of point indices.
   * @returns Deduplicated array of link indices connecting points within the provided set.
   */
  public getConnectedLinkIndices (pointIndices: number | number[]): number[] {
    if (this._isDestroyed) return []
    return this.graph.getConnectedLinkIndices(pointIndices)
  }

  /**
   * Get point indices at the endpoints of the given link(s).
   * @param linkIndices A single link index or an array of link indices.
   * @returns Deduplicated array of point indices at the ends of the provided links.
   */
  public getConnectedPointIndices (linkIndices: number | number[]): number[] {
    if (this._isDestroyed) return []
    return this.graph.getConnectedPointIndices(linkIndices)
  }

  /**
   * Converts the X and Y point coordinates from the space coordinate system to the screen coordinate system.
   * @param spacePosition Array of x and y coordinates in the space coordinate system.
   * @returns Array of x and y coordinates in the screen coordinate system.
   */
  public spaceToScreenPosition (spacePosition: [number, number]): [number, number] {
    if (this._isDestroyed) return [0, 0]
    if (this.warnIf3D('spaceToScreenPosition', 'use `spaceToScreenPosition3D` instead')) return [0, 0]
    return this.zoomInstance.convertSpaceToScreenPosition(spacePosition)
  }

  /**
   * Converts a 3D space position to screen coordinates using the current camera (3D mode only).
   * @param spacePosition Array of x, y and z coordinates in the space coordinate system.
   * @returns Array of x and y coordinates in the screen coordinate system,
   * or `[NaN, NaN]` if the position is behind the camera.
   */
  public spaceToScreenPosition3D (spacePosition: [number, number, number]): [number, number] {
    if (this._isDestroyed) return [0, 0]
    if (!this.store.is3D) {
      console.warn('cosmos.gl: `spaceToScreenPosition3D` is only available in 3D mode')
      return [0, 0]
    }
    return this.camera.project(spacePosition)
  }

  /**
   * Converts screen coordinates to a 3D space position (3D mode only).
   * The screen point is unprojected onto the camera-facing plane through the
   * current orbit target, i.e. the returned position sits at the target's depth.
   * @param screenPosition Array of x and y coordinates in the screen coordinate system.
   * @returns Array of x, y and z coordinates in the space coordinate system.
   */
  public screenToSpacePosition3D (screenPosition: [number, number]): [number, number, number] {
    if (this._isDestroyed) return [0, 0, 0]
    if (!this.store.is3D) {
      console.warn('cosmos.gl: `screenToSpacePosition3D` is only available in 3D mode')
      return [0, 0, 0]
    }
    const target = this.camera.target
    return this.camera.unprojectOnPlane(screenPosition, [target[0], target[1], target[2]])
  }

  /**
   * Get the 3D orbit camera's current state (3D mode only).
   * @returns The camera state (`target`, `distance`, `azimuth`, `polar`),
   * or `undefined` in 2D mode.
   */
  public getCameraState (): Camera3dState | undefined {
    if (this._isDestroyed || !this.store.is3D) return undefined
    return this.camera.getState()
  }

  /**
   * Set the 3D orbit camera's state for programmatic camera control (3D mode only).
   * Cancels an in-progress `fitView` animation.
   * @param state Any subset of `target`, `distance`, `azimuth` and `polar`.
   * @param duration Animation duration in milliseconds; `0` (default) applies instantly.
   */
  public setCameraState (state: Partial<Camera3dState>, duration = 0): void {
    if (this._isDestroyed) return
    if (!this.store.is3D) {
      console.warn('cosmos.gl: `setCameraState` is only available in 3D mode')
      return
    }
    this.camera.setState(state, this.canvasD3Selection, duration)
    // Instant state changes have no tween tick to schedule a redraw
    this.requestRender()
  }

  /**
   * Converts the X and Y point coordinates from the screen coordinate system to the space coordinate system.
   * @param screenPosition Array of x and y coordinates in the screen coordinate system.
   * @returns Array of x and y coordinates in the space coordinate system.
   */
  public screenToSpacePosition (screenPosition: [number, number]): [number, number] {
    if (this._isDestroyed) return [0, 0]
    if (this.warnIf3D('screenToSpacePosition', 'use `screenToSpacePosition3D` instead')) return [0, 0]
    return this.zoomInstance.convertScreenToSpacePosition(screenPosition)
  }

  /**
   * Converts the point radius value from the space coordinate system to the screen coordinate system.
   * @param spaceRadius Radius of point in the space coordinate system.
   * @returns Radius of point in the screen coordinate system.
   */
  public spaceToScreenRadius (spaceRadius: number): number {
    if (this._isDestroyed) return 0
    if (this.warnIf3D('spaceToScreenRadius')) return 0
    return this.zoomInstance.convertSpaceToScreenRadius(spaceRadius)
  }

  /**
   * Get point radius by its index.
   * @param index Index of the point.
   * @returns Radius of the point.
   */
  public getPointRadiusByIndex (index: number): number | undefined {
    if (this._isDestroyed) return undefined
    const shapeSize = this.graph.pointSizes?.[index]
    const imageSize = this.graph.pointImageSizes?.[index]
    if (shapeSize === undefined && imageSize === undefined) return undefined
    return Math.max(shapeSize ?? 0, imageSize ?? 0)
  }

  /**
   * Track multiple point positions by their indices on each Cosmos tick.
   * @param indices Array of points indices.
   */
  public trackPointPositionsByIndices (indices: number[]): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.trackPointPositionsByIndices(indices))) return
    if (!this.points) return
    this.points.trackPointsByIndices(indices)
  }

  /**
   * Get current X and Y coordinates of the tracked points.
   * Do not mutate the returned map - it may affect future calls.
   * @returns A ReadonlyMap where keys are point indices and values are their corresponding X and Y coordinates in the [number, number] format.
   * @see trackPointPositionsByIndices To set which points should be tracked
   */
  public getTrackedPointPositionsMap (): ReadonlyMap<number, [number, number]> {
    if (this._isDestroyed || !this.points) return new Map()
    return this.points.getTrackedPositionsMap()
  }

  /**
   * Get current X and Y coordinates of the tracked points as an array.
   * @returns Array of point positions in the format [x1, y1, x2, y2, ..., xn, yn] for tracked points only.
   * The positions are ordered by the tracking indices (same order as provided to trackPointPositionsByIndices).
   * Returns an empty array if no points are being tracked.
   */
  public getTrackedPointPositionsArray (): number[] {
    if (this._isDestroyed || !this.points) return []
    return this.points.getTrackedPositionsArray()
  }

  /**
   * For the points that are currently visible on the screen, get a sample of point indices with their coordinates.
   * The resulting number of points will depend on the `pointSamplingDistance` configuration property,
   * and the sampled points will be evenly distributed.
   * @returns A Map object where keys are the index of the points and values are their corresponding X and Y coordinates in the [number, number] format.
   */
  public getSampledPointPositionsMap (): Map<number, [number, number]> {
    if (this._isDestroyed || !this.points) return new Map()
    if (this.warnIf3D('getSampledPointPositionsMap', 'use `getSampledPointPositionsMap3D` instead')) return new Map()
    return this.points.getSampledPointPositionsMap()
  }

  /**
   * For the points that are currently visible on the screen, get a sample of point indices
   * with their X, Y and Z coordinates. 3D counterpart of `getSampledPointPositionsMap` —
   * project the returned positions with `spaceToScreenPosition3D` to place labels.
   * The resulting number of points will depend on the `pointSamplingDistance` configuration property.
   * @returns A Map object where keys are point indices and values are their [x, y, z] coordinates
   * (z is `0` in 2D mode).
   */
  public getSampledPointPositionsMap3D (): Map<number, [number, number, number]> {
    if (this._isDestroyed || !this.points) return new Map()
    return this.points.getSampledPointPositionsMap3D()
  }

  /**
   * For the points that are currently visible on the screen, get a sample of point indices and positions.
   * The resulting number of points will depend on the `pointSamplingDistance` configuration property,
   * and the sampled points will be evenly distributed.
   * @returns An object containing arrays of point indices and positions.
   */
  public getSampledPoints (): { indices: number[]; positions: number[] } {
    if (this._isDestroyed || !this.points) return { indices: [], positions: [] }
    if (this.warnIf3D('getSampledPoints', 'use `getSampledPoints3D` instead')) return { indices: [], positions: [] }
    return this.points.getSampledPoints()
  }

  /**
   * For the points that are currently visible on the screen, get a sample of point indices and positions.
   * 3D counterpart of `getSampledPoints` — project the returned positions with
   * `spaceToScreenPosition3D` to place labels.
   * The resulting number of points will depend on the `pointSamplingDistance` configuration property.
   * @returns An object containing arrays of point indices and positions in the format
   * [x1, y1, z1, x2, y2, z2, ...] (z is `0` in 2D mode).
   */
  public getSampledPoints3D (): { indices: number[]; positions: number[] } {
    if (this._isDestroyed || !this.points) return { indices: [], positions: [] }
    return this.points.getSampledPoints3D()
  }

  /**
   * For the links that are currently visible on the screen, get a sample of link indices with their midpoint coordinates and angle.
   * The resulting number of links will depend on the `linkSamplingDistance` configuration property,
   * and the sampled links will be evenly distributed (one link per grid cell, based on link midpoint in screen space).
   * Each value is [x, y, angle]: position in data space; angle in radians for screen-space rotation (0 = right, positive = clockwise, e.g. for CSS rotation).
   */
  public getSampledLinkPositionsMap (): Map<number, [number, number, number]> {
    if (this._isDestroyed || !this.lines) return new Map()
    if (this.warnIf3D('getSampledLinkPositionsMap', 'use `getSampledLinkPositionsMap3D` instead')) return new Map()
    return this.lines.getSampledLinkPositionsMap()
  }

  /**
   * For the links that are currently visible on the screen, get a sample of link indices with their
   * midpoint coordinates and angle. 3D counterpart of `getSampledLinkPositionsMap`.
   * The resulting number of links will depend on the `linkSamplingDistance` configuration property.
   * Each value is [x, y, z, angle]: midpoint in data space (z is `0` in 2D mode); angle in radians
   * for screen-space rotation of the projected link (0 = right, positive = clockwise, e.g. for CSS rotation).
   */
  public getSampledLinkPositionsMap3D (): Map<number, [number, number, number, number]> {
    if (this._isDestroyed || !this.lines) return new Map()
    return this.lines.getSampledLinkPositionsMap3D()
  }

  /**
   * For the links that are currently visible on the screen, get a sample of link indices, midpoint positions, and angles.
   * The resulting number of links will depend on the `linkSamplingDistance` configuration property,
   * and the sampled links will be evenly distributed.
   * Positions are in data space; angles are in radians for screen-space rotation (0 = right, positive = clockwise, e.g. for CSS rotation).
   */
  public getSampledLinks (): { indices: number[]; positions: number[]; angles: number[] } {
    if (this._isDestroyed || !this.lines) return { indices: [], positions: [], angles: [] }
    if (this.warnIf3D('getSampledLinks', 'use `getSampledLinks3D` instead')) return { indices: [], positions: [], angles: [] }
    return this.lines.getSampledLinks()
  }

  /**
   * For the links that are currently visible on the screen, get a sample of link indices, midpoint
   * positions, and angles. 3D counterpart of `getSampledLinks`.
   * The resulting number of links will depend on the `linkSamplingDistance` configuration property.
   * Positions are link midpoints in data space in the format [x1, y1, z1, x2, y2, z2, ...]
   * (z is `0` in 2D mode); angles are in radians for screen-space rotation of the projected links.
   */
  public getSampledLinks3D (): { indices: number[]; positions: number[]; angles: number[] } {
    if (this._isDestroyed || !this.lines) return { indices: [], positions: [], angles: [] }
    return this.lines.getSampledLinks3D()
  }

  /**
   * Gets the X-axis of rescaling function.
   *
   * This scale is automatically created when position rescaling is enabled.
   */
  public getScaleX (): ((x: number) => number) | undefined {
    if (this._isDestroyed || !this.points) return undefined
    return this.points.scaleX
  }

  /**
   * Gets the Y-axis of rescaling function.
   *
   * This scale is automatically created when position rescaling is enabled.
   */
  public getScaleY (): ((y: number) => number) | undefined {
    if (this._isDestroyed || !this.points) return undefined
    return this.points.scaleY
  }

  /**
   * Start the simulation.
   * This only controls the simulation state, not rendering.
   * If the simulation is already running, calling `start(alpha)` reheats it by
   * resetting `alpha` and `simulationProgress` without firing
   * `onSimulationStart` again.
   * @param alpha Value from 0 to 1. The higher the value, the more initial energy the simulation will get.
   */
  public start (alpha = 1): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.start(alpha))) return

    if (!this.config.enableSimulation) return
    if (!this.graph.pointsNumber) return
    if (this.transition.isActiveFor(TransitionProperty.Positions)) {
      // Avoids running simulation against mid-interpolation positions.
      this.transition.end(true)
    }
    const wasRunning = this.store.isSimulationRunning
    this.store.isSimulationRunning = true
    this.store.simulationProgress = 0
    this.store.alpha = alpha
    if (!wasRunning) this.config.onSimulationStart?.()

    // No-op before the first render() — frame() bails while there's nothing renderable
    this.requestRender()
  }

  /**
   * Stop the simulation. This stops the simulation and resets its state.
   * Use start() to begin a new simulation cycle.
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
   * Pause the simulation. When paused, the simulation stops running
   * but preserves its current state (progress, alpha).
   * Can be resumed using the unpause method.
   */
  public pause (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.pause())) return
    if (!this.store.isSimulationRunning) return
    this.store.isSimulationRunning = false
    this.config.onSimulationPause?.()
  }

  /**
   * Unpause the simulation. This method resumes a paused
   * simulation and continues its execution.
   */
  public unpause (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.unpause())) return
    if (!this.config.enableSimulation) return
    if (this.store.isSimulationRunning) return
    if (this.transition.isActiveFor(TransitionProperty.Positions)) {
      // Avoids running simulation against mid-interpolation positions.
      this.transition.end(true)
    }
    this.store.isSimulationRunning = true
    this.config.onSimulationUnpause?.()
    this.requestRender()
  }

  /**
   * Run one step of the simulation manually.
   * Works even when the simulation is paused.
   */
  public step (): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.step())) return

    if (!this.config.enableSimulation) return
    if (!this.store.pointsTextureSize) return

    // Run one simulation step, forcing execution regardless of isSimulationRunning
    this.runSimulationStep(true)
    // A manual step outside the loop is invisible until drawn
    this.requestRender()
  }

  /**
   * Destroy this Cosmos instance.
   */
  public destroy (): void {
    if (this._isDestroyed) return
    this._isDestroyed = true
    this.isReady = false
    this.transition.abort()
    window.clearTimeout(this._fitViewOnInitTimeoutID)
    this.cancelLongPress()
    this.stopFrames()
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined

    // Remove all event listeners — `.on('.cosmos', null)` clears every handler
    // in the `.cosmos` namespace at once (canvas pointer/click/contextmenu and
    // document key listeners), same trick we use for `.drag` / `.zoom`.
    if (this.canvasD3Selection) {
      this.canvasD3Selection
        .on('.cosmos', null)
        .on('.drag', null)
        .on('.zoom', null)
    }

    select(document).on(`.${this.documentEventsNamespace}`, null)

    if (this.zoomInstance?.behavior) {
      this.zoomInstance.behavior
        .on('start.detect', null)
        .on('zoom.detect', null)
        .on('end.detect', null)
    }

    if (this.dragInstance?.behavior) {
      this.dragInstance.behavior
        .on('start.detect', null)
        .on('drag.detect', null)
        .on('end.detect', null)
    }

    this.fpsMonitor?.destroy()

    // Destroy all module resources before destroying the device
    this.points?.destroy()
    this.lines?.destroy()
    this.clusters?.destroy()
    this.forceGravity?.destroy()
    this.forceCenter?.destroy()
    this.forceManyBody?.destroy()
    this.forceLinkIncoming?.destroy()
    this.forceLinkOutgoing?.destroy()
    this.forceCollision?.destroy()

    if (this.device) {
      // Only clear and destroy the device if Graph owns it
      if (this.shouldDestroyDevice) {
        // Clears the canvas after particle system is destroyed
        const clearPass = this.device.beginRenderPass({
          clearColor: this.store.backgroundColor,
          clearDepth: 1,
          clearStencil: 0,
        })
        clearPass.end()
        this.device.submit()
        this.device.destroy()
      }
    }

    // Only remove canvas if Graph owns the device (canvas was created by Graph)
    if (this.shouldDestroyDevice && this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }

    if (this.attributionDivElement && this.attributionDivElement.parentNode) {
      this.attributionDivElement.parentNode.removeChild(this.attributionDivElement)
    }

    document.getElementById('gl-bench-style')?.remove()

    this.canvasD3Selection = undefined
    this.camera.canvasSelection = undefined
    this.attributionDivElement = undefined
  }

  /**
   * Applies pending data changes (positions, colors, sizes, shapes, links, forces, clusters)
   * to the graph visualization. Call this after setting data via methods like `setPointPositions`,
   * `setPointColors`, `setLinks`, etc. if you need to apply changes without calling `render()`.
   */
  public create (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.create())) return
    if (!this.points) return
    if (!this.lines) return
    if (this.isPointPositionsUpdateNeeded) {
      this.points.updatePositions()
      // Links are rasterized from the point positions — a snap position update
      // (no simulation or transition) invalidates the link index buffer too.
      this.lines.isLinkIndexBufferStale = true
    }
    if (this.isPointColorUpdateNeeded) this.points.updateColor()
    if (this.isPointSizeUpdateNeeded) this.points.updateSize()
    if (this.isPointShapeUpdateNeeded) this.points.updateShape()
    if (this.isPointImageIndicesUpdateNeeded) this.points.updateImageIndices()
    if (this.isPointImageSizesUpdateNeeded) this.points.updateImageSizes()

    if (this.isLinksUpdateNeeded) this.lines.updatePointsBuffer()
    if (this.isLinkColorUpdateNeeded) this.lines.updateColor()
    if (this.isLinkWidthUpdateNeeded) this.lines.updateWidth()
    if (this.isLinkArrowUpdateNeeded) this.lines.updateArrow()
    if (this.isLinkStyleUpdateNeeded) this.lines.updateStyle()

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
    this.isPointColorUpdateNeeded = false
    this.isPointSizeUpdateNeeded = false
    this.isPointShapeUpdateNeeded = false
    this.isPointImageIndicesUpdateNeeded = false
    this.isPointImageSizesUpdateNeeded = false
    this.isLinksUpdateNeeded = false
    this.isLinkColorUpdateNeeded = false
    this.isLinkWidthUpdateNeeded = false
    this.isLinkArrowUpdateNeeded = false
    this.isLinkStyleUpdateNeeded = false
    this.isPointClusterUpdateNeeded = false
    this.isForceManyBodyUpdateNeeded = false
    this.isForceLinkUpdateNeeded = false
    this.isForceCenterUpdateNeeded = false

    // Public contract: applies data changes without render() — draw them
    this.requestRender()
  }

  /**
   * Converts an array of tuple positions to a single array containing all coordinates sequentially
   * @param pointPositions An array of tuple positions
   * @returns A flatten array of coordinates
   */
  public flatten (pointPositions: [number, number][]): number[] {
    return pointPositions.flat()
  }

  /**
   * Converts a flat array of point positions to a tuple pairs representing coordinates
   * @param pointPositions A flattened array of coordinates
   * @returns An array of tuple positions
   */
  public pair (pointPositions: number[]): [number, number][] {
    const arr = new Array(pointPositions.length / 2) as [number, number][]
    for (let i = 0; i < pointPositions.length / 2; i++) {
      arr[i] = [pointPositions[i * 2] as number, pointPositions[i * 2 + 1] as number]
    }

    return arr
  }

  /**
   * Restores init-only fields (`initialZoomLevel`, `randomSeed`, `attribution`)
   * to their pre-update values, preventing runtime changes via setConfig/setConfigPartial.
   */
  private preserveInitOnlyFields (prevConfig: GraphConfigInterface): void {
    this.config.initialZoomLevel = prevConfig.initialZoomLevel
    this.config.randomSeed = prevConfig.randomSeed
    this.config.attribution = prevConfig.attribution
  }

  private getFitViewPositions (): Float32Array {
    const useTargetPositions =
      this.transition.isActive &&
      this.transition.isActiveFor(TransitionProperty.Positions) &&
      !!this.graph.pointPositions

    if (useTargetPositions && this.graph.pointPositions) {
      return new Float32Array(this.graph.pointPositions)
    }

    return new Float32Array(this.getPointPositions())
  }

  /**
   * 3D counterpart of `getFitViewPositions`: returns `[x, y, z, ...]` triplets —
   * the transition target positions during an active position transition,
   * otherwise the current GPU positions.
   */
  private getFitViewPositions3D (): Float32Array | number[] {
    const useTargetPositions =
      this.transition.isActive &&
      this.transition.isActiveFor(TransitionProperty.Positions) &&
      !!this.graph.pointPositions

    if (useTargetPositions && this.graph.pointPositions && this.graph.pointDimensions === 3) {
      return this.graph.pointPositions
    }

    return this.getPointPositions3D()
  }

  /**
   * Compares the previous config snapshot with the current `this.config` and
   * applies any necessary side effects (updating renderers, store, behaviors, etc.).
   */
  private updateStateFromConfig (prevConfig: GraphConfigInterface): void {
    this.applyEnableSimulationConfigChange(prevConfig)

    if (prevConfig.pointDefaultColor !== this.config.pointDefaultColor) {
      this.graph.updatePointColor()
      this.points?.updateColor()
    }
    if (prevConfig.pointDefaultSize !== this.config.pointDefaultSize) {
      this.graph.updatePointSize()
      this.points?.updateSize()
    }
    if (prevConfig.pointDefaultShape !== this.config.pointDefaultShape) {
      this.graph.updatePointShape()
      this.points?.updateShape()
    }
    if (prevConfig.linkDefaultColor !== this.config.linkDefaultColor) {
      this.graph.updateLinkColor()
      this.lines?.updateColor()
    }
    if (prevConfig.linkDefaultWidth !== this.config.linkDefaultWidth) {
      this.graph.updateLinkWidth()
      this.lines?.updateWidth()
    }
    if (prevConfig.linkDefaultArrows !== this.config.linkDefaultArrows) {
      this.graph.updateArrows()
      this.lines?.updateArrow()
    }
    if (prevConfig.linkDefaultStyle !== this.config.linkDefaultStyle) {
      this.graph.updateLinkStyles()
      this.lines?.updateStyle()
    }
    if (prevConfig.linkColorInterpolateFromEndpoints !== this.config.linkColorInterpolateFromEndpoints) {
      // updateColor reconciles the endpoint-color texture with the flag:
      // it builds the texture when the gradient turns on and frees it when off.
      this.points?.updateColor()
    }
    if (prevConfig.linkBlending !== this.config.linkBlending) {
      this.lines?.updateLinkBlending()
    }
    if (prevConfig.curvedLinkSegments !== this.config.curvedLinkSegments ||
      prevConfig.curvedLinks !== this.config.curvedLinks) {
      this.lines?.updateCurveLineGeometry()
    }

    if (prevConfig.backgroundColor !== this.config.backgroundColor) {
      this.store.backgroundColor = getRgbaColor(this.config.backgroundColor)
    }
    if (prevConfig.hoveredPointRingColor !== this.config.hoveredPointRingColor) {
      this.store.setHoveredPointRingColor(this.config.hoveredPointRingColor)
    }
    if (prevConfig.focusedPointRingColor !== this.config.focusedPointRingColor) {
      this.store.setFocusedPointRingColor(this.config.focusedPointRingColor)
    }
    if (prevConfig.pointGreyoutColor !== this.config.pointGreyoutColor) {
      this.store.setGreyoutPointColor(this.config.pointGreyoutColor)
    }
    if (prevConfig.hoveredLinkColor !== this.config.hoveredLinkColor) {
      this.store.setHoveredLinkColor(this.config.hoveredLinkColor)
    }
    if (prevConfig.focusedPointIndex !== this.config.focusedPointIndex) {
      this.store.setFocusedPoint(this.config.focusedPointIndex)
    }
    if (prevConfig.outlinedPointRingColor !== this.config.outlinedPointRingColor) {
      this.store.setOutlinedPointRingColor(this.config.outlinedPointRingColor)
    }
    if (prevConfig.highlightedPointIndices !== this.config.highlightedPointIndices) {
      this.store.setHighlightedPointSet(this.config.highlightedPointIndices)
    }
    if (prevConfig.outlinedPointIndices !== this.config.outlinedPointIndices) {
      this.store.setOutlinedPointSet(this.config.outlinedPointIndices)
    }
    if (prevConfig.highlightedPointIndices !== this.config.highlightedPointIndices ||
        prevConfig.outlinedPointIndices !== this.config.outlinedPointIndices) {
      this.points?.updatePointStatus()
    }
    if (prevConfig.highlightedLinkIndices !== this.config.highlightedLinkIndices) {
      this.lines?.updateLinkStatus()
    }
    // The collision grid's cell size is derived from the collision radius and
    // padding, so a change to either requires rebuilding the grid textures.
    // In derived-radius mode (radius 0/undefined) the radius — and the size
    // texture — come from point sizes, so a pointDefaultSize change must also
    // invalidate the collision resources.
    if (prevConfig.simulationCollisionRadius !== this.config.simulationCollisionRadius ||
        prevConfig.simulationCollisionPadding !== this.config.simulationCollisionPadding ||
        ((this.config.simulationCollisionRadius === undefined || this.config.simulationCollisionRadius === 0) &&
         prevConfig.pointDefaultSize !== this.config.pointDefaultSize)) {
      this.isForceCollisionReady = false
    }
    if (prevConfig.pixelRatio !== this.config.pixelRatio) {
      // Update device's canvas context useDevicePixels
      if (this.device?.canvasContext) {
        this.device.canvasContext.setProps({ useDevicePixels: this.config.pixelRatio })

        // Recalculate maxPointSize with new pixelRatio
        this.store.maxPointSize = getMaxPointSize(this.device, this.config.pixelRatio)
      }
    }
    if (prevConfig.spaceSize !== this.config.spaceSize) {
      this.store.adjustSpaceSize(this.config.spaceSize, this.device?.limits.maxTextureDimension2D ?? 4096)
      // The many-body level textures are sized from the space size; without a
      // rebuild its run() staleness guard would silently disable the force.
      this.isForceManyBodyUpdateNeeded = true
      this.resizeCanvas(true)
      this.update(this.store.isSimulationRunning ? this.store.alpha : 0)
    }
    if (prevConfig.showFPSMonitor !== this.config.showFPSMonitor) {
      if (this.config.showFPSMonitor) {
        this.fpsMonitor = new FPSMonitor(this.canvas)
      } else {
        this.fpsMonitor?.destroy()
        this.fpsMonitor = undefined
      }
    }
    if (prevConfig.enableZoom !== this.config.enableZoom || prevConfig.enableDrag !== this.config.enableDrag) {
      this.updateZoomDragBehaviors()
    }
    // The sampling grids bake their cell size from these values at build time;
    // without a rebuild the change would silently apply only on the next resize.
    if (prevConfig.pointSamplingDistance !== this.config.pointSamplingDistance) {
      this.points?.updateSampledPointsGrid()
    }
    if (prevConfig.linkSamplingDistance !== this.config.linkSamplingDistance) {
      this.lines?.updateSampledLinksGrid()
    }
    if (prevConfig.spaceDimensions !== this.config.spaceDimensions) {
      this.setSpaceDimensions(this.config.spaceDimensions)
    }
    if (prevConfig.cameraFov !== this.config.cameraFov ||
        prevConfig.cameraNear !== this.config.cameraNear ||
        prevConfig.cameraFar !== this.config.cameraFar) {
      if (this.store.is3D) this.camera.updateMatrices()
    }

    if (prevConfig.onLinkClick !== this.config.onLinkClick ||
        prevConfig.onLinkContextMenu !== this.config.onLinkContextMenu ||
        prevConfig.onLinkMouseOver !== this.config.onLinkMouseOver ||
        prevConfig.onLinkMouseOut !== this.config.onLinkMouseOut) {
      this.store.updateLinkHoveringEnabled(this.config)
    }

    // Many config options (sizes, widths, arrows, curvature, focused/hovered
    // emphasis, zoom scaling…) feed the picking passes — re-rasterize both
    // buffers rather than tracking each key individually. This also covers
    // spaceDimensions switches (setSpaceDimensions above rebuilt the Models).
    this.markPickingBuffersStale()

    // Config changes above apply visual state immediately — draw it
    this.requestRender()
  }

  /**
   * Applies `enableSimulation` lifecycle changes triggered by config updates.
   */
  private applyEnableSimulationConfigChange (prevConfig: GraphConfigInterface): void {
    if (prevConfig.enableSimulation === this.config.enableSimulation) return

    if (this.config.enableSimulation) {
      // Avoids running simulation against mid-interpolation positions.
      this.transition.end(true)
      this.transition.dequeue(TransitionProperty.Positions)
      this.ensureSimulationModules()
      this.points?.ensureSimulationResources()
      this.isForceManyBodyUpdateNeeded = true
      this.isForceLinkUpdateNeeded = true
      this.isForceCenterUpdateNeeded = true
      // Rebuild simulation resources before binding programs to them.
      this.create()
      this.initPrograms()
      this.store.simulationProgress = 0
      this.store.alpha = 1
      this.store.isSimulationRunning = true
      this._shouldForceHoverDetection = true
      this.config.onSimulationStart?.()
      return
    }

    const wasSimulationActive = this.store.isSimulationRunning || this.store.alpha > 0 || this.store.simulationProgress > 0
    this.store.isSimulationRunning = false
    this.store.alpha = 0
    this.store.simulationProgress = 0
    this._shouldForceHoverDetection = true
    if (wasSimulationActive) this.config.onSimulationEnd?.()
    this.destroySimulationModules()
  }

  /** Marks every texture that depends on point positions (or their count) for rebuild. */
  private markPointPositionsDirty (): void {
    this.isPointPositionsUpdateNeeded = true
    const currentPositionTexture = this.points?.currentPositionTexture
    if (currentPositionTexture && !currentPositionTexture.destroyed) {
      this.transition.queue(TransitionProperty.Positions)
    }
    // Links related texture depends on point positions, so we need to update it
    this.isLinksUpdateNeeded = true
    // Point related textures depend on point positions length, so we need to update them
    this.isPointColorUpdateNeeded = true
    this.isPointSizeUpdateNeeded = true
    this.isPointShapeUpdateNeeded = true
    this.isPointImageIndicesUpdateNeeded = true
    this.isPointImageSizesUpdateNeeded = true
    this.isPointClusterUpdateNeeded = true
    this.isForceManyBodyUpdateNeeded = true
    this.isForceLinkUpdateNeeded = true
    this.isForceCenterUpdateNeeded = true
  }

  /**
   * Switches between 2D and 3D rendering modes: swaps the gesture behaviors
   * (d3-zoom pan/zoom + point drag in 2D, orbit camera in 3D) and rebuilds
   * the mode-specific GPU resources lazily.
   */
  private setSpaceDimensions (dimensions: 2 | 3): void {
    if (this.store.spaceDimensions === dimensions) return
    this.store.spaceDimensions = dimensions

    // The collision grid layout and shaders are mode-specific — rebuild lazily on next use
    this.isForceCollisionReady = false
    // The many-body level textures are mode-specific too (2D quadtree levels vs
    // 3D octree slices). Under data-driven switching markPointPositionsDirty()
    // requested their rebuild; a config-driven switch must do it explicitly or
    // run()'s staleness guard silently disables the force and the layout
    // collapses under gravity with no repulsion.
    this.forceManyBody?.create()
    // The SPACE_3D define is baked into the pipelines at Model creation; each
    // module's initPrograms() recreates its Models when the mode changed. Under
    // data-driven switching this ran via the data-update path — a config-driven
    // switch has no data change, so trigger it explicitly.
    this.initPrograms()

    if (dimensions === 3) {
      const [width, height] = this.store.screenSize
      if (width && height) this.camera.setViewport(width, height)
      // Carry the current 2D framing into the orbit camera so the projection
      // switch doesn't jump; falls back to the data fit when there is no live
      // 2D framing to match yet.
      if (!this.handOffFramingTo3D()) this.maybeInitializeCamera()
    } else {
      this.handOffFramingTo2D()
    }

    this.updateZoomDragBehaviors()
  }

  /**
   * Seeds the orbit camera to reproduce the current 2D framing: top-down pose
   * (matching the 2D orientation) over the same screen-center point, at the
   * distance whose perspective scale at the target plane equals the 2D zoom
   * scale `k` — the projection switch then keeps every point (near the target
   * plane) at the same screen position.
   * @returns `false` when there is no viewport to match yet.
   */
  private handOffFramingTo3D (): boolean {
    const [w, h] = this.store.screenSize
    if (!w || !h) return false
    const k = this.zoomInstance.eventTransform.k
    const center = this.zoomInstance.convertScreenToSpacePosition([w / 2, h / 2])
    const fovY = this.config.cameraFov * Math.PI / 180
    // Perspective px-per-space-unit at the target plane is h / (2·d·tan(fov/2));
    // equating it with the 2D scale k gives the matching camera distance.
    const distance = h / (2 * k * Math.tan(fovY / 2))
    this.camera.setState({
      target: [center[0], center[1], this.store.adjustedSpaceSize / 2],
      distance,
      azimuth: 0, // looks down -z with +y up — the 2D orientation
      polar: Math.PI / 2,
    }, this.canvasD3Selection)
    this._isCameraInitialized = true
    return true
  }

  /**
   * Seeds the 2D zoom transform to reproduce the current 3D framing: the
   * camera's target projects to the screen center at the equivalent zoom
   * scale. Exact when the camera is in the top-down pose (e.g. after an
   * animated `setCameraState({ azimuth: 0, polar: Math.PI / 2 })`).
   */
  private handOffFramingTo2D (): void {
    const [w, h] = this.store.screenSize
    if (!w || !h || !this._isCameraInitialized) return
    const { target, distance } = this.camera.getState()
    const fovY = this.config.cameraFov * Math.PI / 180
    const k = h / (2 * distance * Math.tan(fovY / 2))
    const transform = this.zoomInstance.getTransform([target[0], target[1]], k)
    this.canvasD3Selection?.call(this.zoomInstance.behavior.transform, transform)
  }

  /**
   * Seeds the 3D camera the first time 3D mode and point data are both
   * available: places it at `cameraInitialPosition` when configured,
   * otherwise frames the data (2D data is framed in the `z = 0` plane).
   */
  private maybeInitializeCamera (): void {
    if (this._isCameraInitialized || !this.store.is3D) return
    const positions = this.graph.inputPointPositions
    if (!positions || positions.length === 0) return
    const dimensions = this.graph.inputPointDimensions
    this._isCameraInitialized = true
    const { cameraInitialPosition, fitViewPadding } = this.config
    if (cameraInitialPosition) {
      this.camera.setEyePosition(cameraInitialPosition, positions, dimensions)
      // Re-seed the gesture baseline — otherwise the first wheel after this
      // programmatic placement would dolly from a stale distance.
      if (this.canvasD3Selection) this.camera.reseedZoomState(this.canvasD3Selection)
    } else if (this.canvasD3Selection) {
      this.camera.fitToPositions(this.canvasD3Selection, positions, dimensions, fitViewPadding, 0)
    } else {
      // No canvas selection yet — let a later call seed the camera once it exists.
      this._isCameraInitialized = false
    }
  }

  /**
   * Warns that a method is not supported in 3D mode.
   * @returns `true` when in 3D mode (the caller should bail out), `false` otherwise.
   */
  private warnIf3D (methodName: string, hint?: string): boolean {
    if (!this.store.is3D) return false
    console.warn(`cosmos.gl: \`${methodName}\` is not supported in 3D mode${hint ? `; ${hint}` : ''}`)
    return true
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
   * Validates that a device has the required HTMLCanvasElement canvas context.
   * Cosmos requires an HTMLCanvasElement canvas context and does not support
   * OffscreenCanvas or compute-only devices.
   * @param device - The device to validate
   * @returns The validated canvas context (guaranteed to be non-null and HTMLCanvasElement type)
   * @throws Error if the device does not meet Cosmos requirements
   */
  private validateDevice (device: Device): NonNullable<Device['canvasContext']> {
    const deviceCanvasContext = device.canvasContext
    // Cosmos requires an HTMLCanvasElement canvas context.
    // OffscreenCanvas and compute-only devices are not supported.
    if (deviceCanvasContext === null || deviceCanvasContext.type === 'offscreen-canvas') {
      throw new Error('Device must have an HTMLCanvasElement canvas context. OffscreenCanvas and compute-only devices are not supported.')
    }
    return deviceCanvasContext
  }

  /**
   * Internal device creation method
   * Graph class decides what device to create with sensible defaults
   */
  private async createDevice (
    canvas: HTMLCanvasElement
  ): Promise<Device> {
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
  * Updates and recreates the graph visualization based on pending changes.
  *
  * @param simulationAlpha - Optional alpha value to set. If not provided, keeps current alpha.
  */
  private update (simulationAlpha = this.store.alpha): void {
    const { graph } = this
    this.store.pointsTextureSize = Math.ceil(Math.sqrt(graph.pointsNumber ?? 0))
    this.store.linksTextureSize = Math.ceil(Math.sqrt((graph.linksNumber ?? 0) * 2))
    this.create()
    this.initPrograms()
    this.store.alpha = simulationAlpha
  }

  /**
   * Runs one step of the simulation (forces, position updates, alpha decay).
   * This is the core simulation logic that can be called by step() or during rendering.
   *
   * @param forceExecution - Controls whether to run the simulation step when paused.
   *   - If true: Always runs the simulation step, even when isSimulationRunning is false.
   *     Used by step() to allow manual stepping while the simulation is paused.
   *   - If false: Only runs if isSimulationRunning is true. Used during rendering
   *     to respect pause/unpause state.
   */
  private runSimulationStep (forceExecution = false): void {
    const { config: { simulationGravity, simulationCenter, simulationCollision, enableSimulation }, store: { isSimulationRunning } } = this

    if (!enableSimulation) return

    // Main simulation forces gate:
    // If forceExecution is true (from step()), always run.
    // Otherwise, respect isSimulationRunning and zoom state.
    const enableSimulationDuringZoom = this.zoomInstance.shouldEnableSimulationDuringZoomOverride ?? this.config.enableSimulationDuringZoom
    const shouldRunSimulation = forceExecution ||
      (isSimulationRunning && !(this.zoomInstance.isRunning && !enableSimulationDuringZoom))

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

      if (this.graph.pointClusters || this.graph.clusterPositions) {
        this.points?.swapFbo()
        this.clusters?.run()
        this.points?.updatePosition()
      }

      // Collision runs after the attraction forces (links, clusters) so it
      // corrects the overlap they introduce within the same tick, instead of
      // lagging one frame behind and oscillating against them.
      if (simulationCollision) {
        // Lazily allocate the collision GPU resources on first use (or after a
        // data change marked them stale), so a graph that never enables
        // collision never pays the grid/size-texture memory cost.
        if (!this.isForceCollisionReady) {
          this.forceCollision?.create()
          this.forceCollision?.initPrograms()
          this.isForceCollisionReady = true
        }
        // Each iteration rebuilds the spatial grid from the freshly updated
        // positions, so extra iterations stiffen the collision constraint
        // (overlaps resolve within the tick) like d3-force's collide.iterations.
        const collisionIterations = Math.max(1, Math.round(this.config.simulationCollisionIterations ?? 1))
        for (let i = 0; i < collisionIterations; i += 1) {
          this.points?.swapFbo()
          this.forceCollision?.run()
          this.points?.updatePosition()
        }
      }

      // Simulation moved the points — the picking buffers no longer match them
      this.markPickingBuffersStale()

      // Alpha decay and progress
      this.store.alpha += this.store.addAlpha(this.config.simulationDecay)
      this.store.simulationProgress = Math.sqrt(Math.min(1, ALPHA_MIN / this.store.alpha))

      this.config.onSimulationTick?.(
        this.store.alpha,
        this.store.hoveredPoint?.index,
        this.store.hoveredPoint?.position
      )
    }

    // Track points (runs regardless of simulation state)
    this.points?.trackPoints()
  }

  private initPrograms (): void {
    if (this._isDestroyed || !this.points || !this.lines || !this.clusters) return
    this.points.initPrograms()
    this.lines.initPrograms()
    this.forceGravity?.initPrograms()
    this.forceManyBody?.initPrograms()
    this.forceCenter?.initPrograms()
    this.forceLinkIncoming?.initPrograms()
    this.forceLinkOutgoing?.initPrograms()
    // ForceCollision programs are built lazily on first use (see runSimulationStep)
    this.clusters.initPrograms()
  }

  private ensureSimulationModules (): void {
    if (!this.device || !this.points) return

    this.forceGravity ||= new ForceGravity(this.device, this.config, this.store, this.graph, this.points)
    this.forceCenter ||= new ForceCenter(this.device, this.config, this.store, this.graph, this.points)
    this.forceManyBody ||= new ForceManyBody(this.device, this.config, this.store, this.graph, this.points)
    this.forceLinkIncoming ||= new ForceLink(this.device, this.config, this.store, this.graph, this.points)
    this.forceLinkOutgoing ||= new ForceLink(this.device, this.config, this.store, this.graph, this.points)
    this.forceCollision ||= new ForceCollision(this.device, this.config, this.store, this.graph, this.points)
  }

  private destroySimulationModules (): void {
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
    this.forceCollision?.destroy()
    this.forceCollision = undefined
    // Force lazy re-allocation if collision is re-enabled on a new instance.
    this.isForceCollisionReady = false
    this.points?.destroySimulationResources()
  }

  /**
   * Schedules a frame if none is pending. The RAF callback renders once and
   * reschedules only while `shouldKeepRendering()` — when the scene is static,
   * no frames run at all.
   */
  private frame (): void {
    if (this._isDestroyed) return
    if (this.requestAnimationFrameId) return // frame already scheduled
    // Nothing renderable: before the first render(), or after render() cleared
    // the data. Without this guard a later pointermove would resurrect drawing
    // of stale GPU buffers (empty-data render() stops frames but doesn't clear
    // pointsTextureSize).
    if (!this.store.pointsTextureSize || (!this.graph.pointsNumber && !this.graph.linksNumber)) return

    this.requestAnimationFrameId = window.requestAnimationFrame((now) => {
      this.requestAnimationFrameId = 0

      // Check if simulation should end BEFORE rendering
      // This prevents one extra simulation step after alpha decays below ALPHA_MIN
      const { store: { alpha, isSimulationRunning } } = this
      if (alpha < ALPHA_MIN && isSimulationRunning) {
        this.end()
      }

      this.renderFrame(now)

      if (!this._isDestroyed && this.shouldKeepRendering()) {
        this.frame()
      }
    })
  }

  /**
   * Request a redraw. No-op if a frame is already scheduled. All internal
   * events that can change visual state funnel through this.
   */
  private requestRender (): void {
    if (this._isDestroyed) return
    this.frame()
  }

  /**
   * Whether the loop must continue past the current frame — true while any
   * continuous activity can still change visual state.
   */
  private shouldKeepRendering (): boolean {
    // gl-bench derives FPS from frame cadence; keep the loop continuous while
    // the monitor is shown so its numbers stay meaningful.
    if (this.fpsMonitor) return true
    if (this.store.isSimulationRunning) return true // alpha floor handled by end() in frame()
    // Not isPending: only render()'s transition.start() activates a pending
    // transition, and render() schedules frames right after — while a
    // queued-but-never-rendered transition must not keep the loop alive.
    if (this.transition.isActive) return true
    if (this.dragInstance.isActive) return true
    if (this.zoomInstance.isRunning) return true // user gesture or programmatic d3 zoom transition
    if (this.camera.isRunning) return true // 3D orbit/pan/dolly gesture in flight
    // Async pick readbacks resolve by polling their GPU fences inside
    // renderFrame — a stopped loop would strand an issued pick forever.
    if (this.points?.isPickInFlight || this.lines?.isPickInFlight) return true
    return this.hasPendingHoverWork()
  }

  /**
   * Whether findHoveredItem() still has work to do. Keeps the loop alive
   * through the hover throttle (up to MAX_HOVER_DETECTION_DELAY frames) until
   * detection actually executes — which updates _lastCheckedMouseX/Y and
   * consumes _shouldForceHoverDetection, turning this false.
   */
  private hasPendingHoverWork (): boolean {
    if (!this._isPointerOnCanvas) return false
    if (this._shouldForceHoverDetection) return true
    const deltaX = Math.abs(this._lastMouseX - this._lastCheckedMouseX)
    const deltaY = Math.abs(this._lastMouseY - this._lastCheckedMouseY)
    return deltaX > MIN_MOUSE_MOVEMENT_THRESHOLD || deltaY > MIN_MOUSE_MOVEMENT_THRESHOLD
  }

  /**
   * Renders a single frame (the actual rendering logic).
   * This does NOT schedule the next frame.
   */
  private renderFrame (now?: number): void {
    if (this._isDestroyed) return
    if (!this.store.pointsTextureSize) return

    const frameNow = now ?? performance.now()
    this.fpsMonitor?.begin()
    this.resizeCanvas()

    const shouldInterpolatePositions = this.transition.isActiveFor(TransitionProperty.Positions)
    const shouldAnimatePointColors = this.transition.isActiveFor(TransitionProperty.PointColors)
    const shouldAnimatePointSizes = this.transition.isActiveFor(TransitionProperty.PointSizes)
    const shouldAnimateLinkColors = this.transition.isActiveFor(TransitionProperty.LinkColors)
    const shouldAnimateLinkWidths = this.transition.isActiveFor(TransitionProperty.LinkWidths)
    if (this.transition.isActive) {
      this.transition.step()

      if (shouldInterpolatePositions) {
        this.points?.interpolatePosition(this.transition.progress)
        this.points?.trackPoints()
        this.markPickingBuffersStale()
      }
    }

    this.points?.setTransitionProgress(this.transition.progress, shouldAnimatePointColors, shouldAnimatePointSizes)
    this.lines?.setTransitionProgress(this.transition.progress, shouldAnimateLinkColors, shouldAnimateLinkWidths)

    if (!this.dragInstance.isActive) {
      // Collect the result of a previously issued async pick (if the GPU is done)
      // before possibly issuing a new one.
      this.resolvePendingPick()
      this.findHoveredItem()
    }

    // Run simulation step (respects isSimulationRunning)
    // When simulation ends, forces stop but rendering continues
    this.runSimulationStep(false)

    // Create a single render pass for drawing (points, lines, etc.)
    // Simulation will use separate render passes later
    if (this.device) {
      const backgroundColor = this.store.backgroundColor ?? [0, 0, 0, 1]
      const drawRenderPass = this.device.beginRenderPass({
        clearColor: backgroundColor,
        clearDepth: 1,
        clearStencil: 0,
      })

      const { config: { renderLinks } } = this
      const shouldDrawLinks =
        renderLinks !== false &&
        !!this.store.linksTextureSize &&
        !!this.graph.linksNumber &&
        this.graph.linksNumber > 0

      if (this.store.is3D) {
        // In 3D points draw first: they write depth, so links drawn after are
        // occluded by nearer points and blend over farther ones.
        this.points?.draw(drawRenderPass)
        if (shouldDrawLinks) {
          this.lines?.draw(drawRenderPass)
        }
      } else {
        if (shouldDrawLinks) {
          this.lines?.draw(drawRenderPass)
        }

        this.points?.draw(drawRenderPass)
      }

      if (this.dragInstance.isActive) {
        // Swap-before-write: after the swap, `previous` holds the freshest positions so drag()
        // reads those and writes the drag result into `current`. This runs
        // after points.draw() above — the drag result becomes visible on
        // the next frame; trackPoints() picks it up immediately below.
        this.points?.swapFbo()
        this.points?.drag()
        // Update tracked positions after drag, even when simulation is disabled
        this.points?.trackPoints()
        this.markPickingBuffersStale()
      }

      drawRenderPass.end()
      this.device.submit()
    }

    this.fpsMonitor?.end(frameNow)

    this.currentEvent = undefined
  }

  private stopFrames (): void {
    if (this.requestAnimationFrameId) {
      window.cancelAnimationFrame(this.requestAnimationFrameId)
      this.requestAnimationFrameId = 0 // Reset to 0
    }
  }

  /**
   * Called automatically when simulation completes (alpha < ALPHA_MIN).
   * Rendering continues after this is called (for rendering/interaction).
   */
  private end (): void {
    this.store.isSimulationRunning = false
    this.store.simulationProgress = 1
    this.config.onSimulationEnd?.()
    // Force hover detection on next frame since points may have moved under stationary mouse
    this._shouldForceHoverDetection = true
  }

  private onClick (event: MouseEvent): void {
    if (this._shouldSuppressNextClick) {
      // Long-press just fired contextmenu for this same touch; drop the
      // synthesized click so callers don't see a click + contextmenu pair.
      this._shouldSuppressNextClick = false
      return
    }
    this.config.onClick?.(
      this.store.hoveredPoint?.index,
      this.store.hoveredPoint?.position,
      event
    )

    if (this.store.hoveredPoint) {
      this.config.onPointClick?.(
        this.store.hoveredPoint.index,
        this.store.hoveredPoint.position,
        event
      )
    } else if (this.store.hoveredLinkIndex !== undefined) {
      this.config.onLinkClick?.(
        this.store.hoveredLinkIndex,
        event
      )
    } else {
      this.config.onBackgroundClick?.(
        event
      )
    }
  }

  private updateMousePosition (event: MouseEvent | D3DragEvent<HTMLCanvasElement, undefined, Hovered>): void {
    if (!event) return
    const mouseX = (event as MouseEvent).offsetX ?? (event as D3DragEvent<HTMLCanvasElement, undefined, Hovered>).x
    const mouseY = (event as MouseEvent).offsetY ?? (event as D3DragEvent<HTMLCanvasElement, undefined, Hovered>).y
    if (mouseX === undefined || mouseY === undefined) return
    if (this.store.is3D) {
      // During a 3D point drag, unproject the cursor onto the camera-facing plane
      // through the dragged point's position at drag start.
      if (this.dragInstance.isActive && this.store.dragPlanePoint3D) {
        this.store.mousePosition3D = this.camera.unprojectOnPlane([mouseX, mouseY], this.store.dragPlanePoint3D)
      }
    } else {
      // Space-coordinate mouse position is a 2D-zoom concept (consumed by drag and
      // mouse repulsion); screen position drives picking in both modes.
      this.store.mousePosition = this.zoomInstance.convertScreenToSpacePosition([mouseX, mouseY])
    }
    this.store.screenMousePosition = [mouseX, (this.store.screenSize[1] - mouseY)]
  }

  private onContextMenu (event: MouseEvent): void {
    event.preventDefault()
    // The browser may fire contextmenu on its own during a long-press (Android
    // Chrome does this on some elements). Cancel our timer so we don't also
    // fire it, and suppress the click that some browsers still synthesize after.
    this.cancelLongPress()
    this._shouldSuppressNextClick = true
    this.fireContextMenu(event)
  }

  /** Clear the pending touch/pen long-press timer, if any. */
  private cancelLongPress (): void {
    if (this._longPressTimerId !== undefined) {
      window.clearTimeout(this._longPressTimerId)
      this._longPressTimerId = undefined
    }
  }

  /**
   * Dispatch the contextmenu callback chain — shared between the desktop
   * `contextmenu` handler and the touch/pen long-press timer.
   */
  private fireContextMenu (event: MouseEvent): void {
    this.config.onContextMenu?.(
      this.store.hoveredPoint?.index,
      this.store.hoveredPoint?.position,
      event
    )

    if (this.store.hoveredPoint) {
      this.config.onPointContextMenu?.(
        this.store.hoveredPoint.index,
        this.store.hoveredPoint.position,
        event
      )
    } else if (this.store.hoveredLinkIndex !== undefined) {
      this.config.onLinkContextMenu?.(
        this.store.hoveredLinkIndex,
        event
      )
    } else {
      this.config.onBackgroundContextMenu?.(
        event
      )
    }
  }

  private resizeCanvas (forceResize = false): void {
    if (this._isDestroyed) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const [prevW, prevH] = this.store.screenSize

    // Check if CSS size changed (luma.gl's autoResize handles canvas.width/height automatically)
    if (forceResize || prevW !== w || prevH !== h) {
      if (this.store.is3D) {
        this.store.updateScreenSize(w, h)
        this.camera.setViewport(w, h)
        this.points?.updateSampledPointsGrid()
        this.lines?.updateSampledLinksGrid()
      } else {
        const { k } = this.zoomInstance.eventTransform
        const centerPosition = this.zoomInstance.convertScreenToSpacePosition([prevW / 2, prevH / 2])

        this.store.updateScreenSize(w, h)
        // Note: canvas.width and canvas.height are managed by luma.gl's autoResize
        // We only update our internal state and dependent components
        this.canvasD3Selection
          ?.call(this.zoomInstance.behavior.transform, this.zoomInstance.getTransform(centerPosition, k))
        this.points?.updateSampledPointsGrid()
        this.lines?.updateSampledLinksGrid()
      }
      // Only update link index FBO if link hovering is enabled
      if (this.store.isLinkHoveringEnabled) {
        this.lines?.updateLinkIndexFbo()
      }
      // The picking buffers are sized to the screen; a resize invalidates them.
      this.markPickingBuffersStale()
    }
  }

  private updateZoomDragBehaviors (): void {
    const zoomBehavior = this.store.is3D ? this.camera.behavior : this.zoomInstance.behavior
    // Panning (2D) and orbiting (3D) ride on the same d3-zoom behavior as the
    // zoom gestures, so `enableZoom: false` cannot simply unbind everything:
    // wheel and double-click get their listeners removed, and pinch (the only
    // zoom gesture sharing the touch listeners with panning) is rejected by a
    // gesture filter that blocks a second touch point. When zoom is enabled the
    // filter reverts to d3-zoom's default.
    zoomBehavior.filter(this.config.enableZoom ? defaultZoomGestureFilter : panOnlyZoomGestureFilter)

    if (this.store.is3D) {
      // Point dragging binds before the camera so a drag that starts on a hovered
      // point captures the gesture; everywhere else the camera orbits. The camera
      // behavior replaces the 2D zoom listeners (same `.zoom` namespace).
      if (this.config.enableDrag) {
        this.canvasD3Selection?.call(this.dragInstance.behavior)
      } else {
        this.canvasD3Selection
          ?.call(this.dragInstance.behavior)
          .on('.drag', null)
      }
      if (this.config.enableZoom) {
        this.canvasD3Selection?.call(this.camera.behavior)
      } else {
        this.canvasD3Selection
          ?.call(this.camera.behavior)
          .on('wheel.zoom', null)
          .on('dblclick.zoom', null)
      }
      this.updateCanvasTouchAction()
      return
    }

    if (this.config.enableDrag) {
      this.canvasD3Selection?.call(this.dragInstance.behavior)
    } else {
      this.canvasD3Selection
        ?.call(this.dragInstance.behavior)
        .on('.drag', null)
    }

    if (this.config.enableZoom) {
      this.canvasD3Selection?.call(this.zoomInstance.behavior)
    } else {
      this.canvasD3Selection
        ?.call(this.zoomInstance.behavior)
        .on('wheel.zoom', null)
        .on('dblclick.zoom', null)
    }

    this.updateCanvasTouchAction()
  }

  /**
   * Only steal touch gestures when cosmos uses them. With both flags off
   * the page can scroll over the canvas.
   */
  private updateCanvasTouchAction (): void {
    // In 3D the orbit camera always consumes drag gestures (rotation).
    this.canvas.style.touchAction =
      this.config.enableDrag || this.config.enableZoom || this.store.is3D ? 'none' : ''
  }

  private findHoveredItem (immediate = false): void {
    if (this._isDestroyed) return
    if (!immediate && !this._isPointerOnCanvas) return
    // TODO: Hover can stay enabled during point size transitions once point picking
    // consumes the same interpolated point sizes as the draw pass.
    // Picking is unreliable mid-transition, so we skip even when called immediately.
    if (this.transition.isActiveFor(TransitionProperty.PointSizes)) return
    if (!immediate && this._findHoveredItemExecutionCount < MAX_HOVER_DETECTION_DELAY) {
      this._findHoveredItemExecutionCount += 1
      return
    }

    // Check if mouse has moved significantly since last hover detection
    const deltaX = Math.abs(this._lastMouseX - this._lastCheckedMouseX)
    const deltaY = Math.abs(this._lastMouseY - this._lastCheckedMouseY)
    const mouseMoved = deltaX > MIN_MOUSE_MOVEMENT_THRESHOLD || deltaY > MIN_MOUSE_MOVEMENT_THRESHOLD

    // Skip if mouse hasn't moved AND not forced
    if (!immediate && !mouseMoved && !this._shouldForceHoverDetection) {
      return
    }

    // Update last checked position
    this._lastCheckedMouseX = this._lastMouseX
    this._lastCheckedMouseY = this._lastMouseY

    // Reset force flag after use
    this._shouldForceHoverDetection = false

    this._findHoveredItemExecutionCount = 0

    // The view transform is an input to the picking buffer — a zoom, orbit or
    // resize since the last detection invalidates it.
    this.updatePickingBufferStaleness()

    const isLinkPickingActive = !!this.graph.linksNumber && this.store.isLinkHoveringEnabled
    if (immediate) {
      // Clicks, drag starts and long-presses need the result within the same
      // event — take the small synchronous window reads.
      const picked = this.points?.pickPointSync() ?? null
      let pickedLink: number | null | undefined
      // Points win over links, so the link read is only needed with no point hit
      if (!picked && isLinkPickingActive) pickedLink = this.lines?.pickLinkSync() ?? null
      this.processHoverResult(picked, pickedLink)
    } else {
      // Frame-loop hover reads asynchronously (PBO + fence): the results are
      // collected by resolvePendingPick() one or more frames later, so the
      // pipeline never stalls on a readback.
      this.points?.requestPickPoint()
      if (isLinkPickingActive) this.lines?.requestPickLink()
    }
  }

  /** Marks both picking buffers stale when the view transform changed since the last check. */
  private updatePickingBufferStaleness (): void {
    const matrix = this.store.transformationMatrix4x4
    let changed = this._lastPickingMatrix.length !== matrix.length
    if (!changed) {
      for (const [i, value] of matrix.entries()) {
        if (value !== this._lastPickingMatrix[i]) {
          changed = true
          break
        }
      }
    }
    if (changed) {
      this._lastPickingMatrix = Array.from(matrix)
      this.markPickingBuffersStale()
    }
  }

  /**
   * Marks the point and link picking buffers stale — the scene they were
   * rasterized from (positions, sizes/widths, status, view transform) changed.
   */
  private markPickingBuffersStale (): void {
    if (this.points) this.points.isPickingBufferStale = true
    if (this.lines) this.lines.isLinkIndexBufferStale = true
  }

  /** Applies the results of async picks once the GPU readbacks complete. */
  private resolvePendingPick (): void {
    // Always drain the readbacks (take* consumes them), but discard a result
    // that landed after the pointer left the canvas: pointerleave already
    // cleared hover, and re-applying a pick for a cursor that's gone would leave
    // it stuck. The synchronous hover path likewise skips when off-canvas.
    // Reads are issued point-first, and fences signal in submission order, so a
    // ready link result implies the point result of the same detection is ready.
    const picked = this.points?.takePickResult()
    const pickedLink = this.lines?.takePickLinkResult()
    if (picked === undefined && pickedLink === undefined) return
    if (!this._isPointerOnCanvas) return
    this.processHoverResult(picked, pickedLink)
  }

  /**
   * Applies point and link pick results and fires the hover callbacks —
   * `undefined` for either means "no new information, keep the current state".
   * On the async path the pointer event that triggered the picks is already
   * gone, so `currentEvent` may be undefined — same as for detections forced
   * without a fresh event.
   */
  private processHoverResult (picked: Hovered | null | undefined, pickedLink: number | null | undefined): void {
    if (this._isDestroyed) return
    // Two-phase hover detection: first update state, then fire callbacks.
    // This guarantees mouseout fires before mouseover when transitioning
    // between element types (e.g. link → point).
    const point = picked === undefined ? { mouseover: false, mouseout: false } : this.applyPickedPoint(picked)
    let link = { mouseover: false, mouseout: false }

    if (this.graph.linksNumber && this.store.isLinkHoveringEnabled) {
      if (this.store.hoveredPoint) {
        // A hovered point takes priority — a link is never hovered through it
        link = this.applyPickedLink(null)
      } else if (pickedLink !== undefined) {
        link = this.applyPickedLink(pickedLink)
      }
    } else if (this.store.hoveredLinkIndex !== undefined) {
      // Clear stale hoveredLinkIndex when there are no links
      link = this.applyPickedLink(null)
    }

    // Fire mouseout events first
    if (point.mouseout) this.config.onPointMouseOut?.(this.currentEvent)
    if (link.mouseout) this.config.onLinkMouseOut?.(this.currentEvent)

    // Then fire mouseover events
    if (point.mouseover && this.store.hoveredPoint) {
      const idx = this.store.hoveredPoint.index
      this.config.onPointMouseOver?.(
        this.store.hoveredPoint.index,
        this.store.hoveredPoint.position,
        this.currentEvent,
        this.store.highlightedPointSet?.has(idx) ?? false,
        this.store.outlinedPointSet?.has(idx) ?? false
      )
    }
    if (link.mouseover && this.store.hoveredLinkIndex !== undefined) {
      this.config.onLinkMouseOver?.(this.store.hoveredLinkIndex)
    }

    this.updateCanvasCursor()
  }

  /** Applies a picked point to the store. Returns flags for deferred callback firing. */
  private applyPickedPoint (picked: Hovered | null): { mouseover: boolean; mouseout: boolean } {
    let isMouseover = false
    let isMouseout = false

    if (picked) {
      if (this.store.hoveredPoint === undefined || this.store.hoveredPoint.index !== picked.index) {
        isMouseover = true
      }
      this.store.hoveredPoint = picked
    } else {
      if (this.store.hoveredPoint) isMouseout = true
      this.store.hoveredPoint = undefined
    }

    return { mouseover: isMouseover, mouseout: isMouseout }
  }

  /** Applies a picked link to the store. Returns flags for deferred callback firing. */
  private applyPickedLink (pickedLinkIndex: number | null): { mouseover: boolean; mouseout: boolean } {
    let isMouseover = false
    let isMouseout = false

    if (pickedLinkIndex !== null) {
      if (this.store.hoveredLinkIndex !== pickedLinkIndex) isMouseover = true
      this.store.hoveredLinkIndex = pickedLinkIndex
    } else {
      if (this.store.hoveredLinkIndex !== undefined) isMouseout = true
      this.store.hoveredLinkIndex = undefined
    }

    // The hovered link is drawn wider in the index pass (hover hysteresis), so
    // a hover change invalidates the link picking buffer.
    if ((isMouseover || isMouseout) && this.lines) this.lines.isLinkIndexBufferStale = true

    return { mouseover: isMouseover, mouseout: isMouseout }
  }

  private updateCanvasCursor (): void {
    const { hoveredPointCursor, hoveredLinkCursor } = this.config
    if (this.dragInstance.isActive) select(this.canvas).style('cursor', 'grabbing')
    else if (this.store.hoveredPoint) {
      if (!this.config.enableDrag || this.store.isSpaceKeyPressed) select(this.canvas).style('cursor', hoveredPointCursor)
      else select(this.canvas).style('cursor', 'grab')
    } else if (this.store.isLinkHoveringEnabled && this.store.hoveredLinkIndex !== undefined) {
      select(this.canvas).style('cursor', hoveredLinkCursor)
    } else select(this.canvas).style('cursor', null)
  }

  private addAttribution (): void {
    if (!this.config.attribution) return
    this.attributionDivElement = document.createElement('div')
    this.attributionDivElement.style.cssText = `
      user-select: none;
      position: absolute;
      bottom: 0;
      right: 0;
      color: var(--cosmosgl-attribution-color);
      margin: 0 0.6rem 0.6rem 0;
      font-size: 0.7rem;
      font-family: inherit;
    `
    // Sanitize the attribution HTML content to prevent XSS attacks
    // Use more permissive settings for attribution since it's controlled by the library user
    this.attributionDivElement.innerHTML = sanitizeHtml(this.config.attribution, {
      ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'span', 'div', 'p', 'br', 'img'],
      ALLOWED_ATTR: ['href', 'target', 'class', 'id', 'style', 'src', 'alt', 'title'],
    })
    this.store.div?.appendChild(this.attributionDivElement)
  }
}

export type { GraphConfig } from './config'
export type { Camera3dState } from './modules/Camera'
export { PointShape, LinkStyle } from './modules/GraphData'
export { TransitionEasing } from './modules/Transition'

export * from './variables'
export * from './helper'
