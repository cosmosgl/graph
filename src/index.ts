import { select, Selection } from 'd3-selection'
import 'd3-transition'
import { easeQuadInOut, easeQuadIn, easeQuadOut } from 'd3-ease'
import { D3ZoomEvent } from 'd3-zoom'
import { D3DragEvent } from 'd3-drag'
import { Device, Framebuffer, luma } from '@luma.gl/core'
import { WebGLDevice, webgl2Adapter } from '@luma.gl/webgl'
import { GL } from '@luma.gl/constants'

import { GraphConfig, GraphConfigInterface } from '@/graph/config'
import { getRgbaColor, readPixels, sanitizeHtml } from '@/graph/helper'
import { ForceCenter } from '@/graph/modules/ForceCenter'
import { ForceGravity } from '@/graph/modules/ForceGravity'
import { ForceLink, LinkDirection } from '@/graph/modules/ForceLink'
import { ForceManyBody } from '@/graph/modules/ForceManyBody'
import { ForceMouse } from '@/graph/modules/ForceMouse'
import { Clusters } from '@/graph/modules/Clusters'
import { FPSMonitor } from '@/graph/modules/FPSMonitor'
import { GraphData } from '@/graph/modules/GraphData'
import { Lines } from '@/graph/modules/Lines'
import { Points } from '@/graph/modules/Points'
import { Store, ALPHA_MIN, MAX_POINT_SIZE, MAX_HOVER_DETECTION_DELAY, type Hovered } from '@/graph/modules/Store'
import { Zoom } from '@/graph/modules/Zoom'
import { Drag } from '@/graph/modules/Drag'
import { defaultConfigValues, defaultScaleToZoom, defaultGreyoutPointColor, defaultBackgroundColor } from '@/graph/variables'

export class Graph {
  public config = new GraphConfig()
  public graph = new GraphData(this.config)
  private canvas: HTMLCanvasElement
  private attributionDivElement: HTMLElement | undefined
  private canvasD3Selection: Selection<HTMLCanvasElement, undefined, null, undefined> | undefined
  private device: Device | undefined
  private deviceInitPromise: Promise<Device>
  private requestAnimationFrameId = 0
  private isRightClickMouse = false

  private store = new Store()
  private points: Points | undefined
  private lines: Lines | undefined
  private forceGravity: ForceGravity | undefined
  private forceCenter: ForceCenter | undefined
  private forceManyBody: ForceManyBody | undefined
  private forceLinkIncoming: ForceLink | undefined
  private forceLinkOutgoing: ForceLink | undefined
  private forceMouse: ForceMouse | undefined
  private clusters: Clusters | undefined
  private zoomInstance = new Zoom(this.store, this.config)
  private dragInstance = new Drag(this.store, this.config)

  private fpsMonitor: FPSMonitor | undefined

  private currentEvent: D3ZoomEvent<HTMLCanvasElement, undefined> | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | MouseEvent | undefined
  /**
   * The value of `_findHoveredItemExecutionCount` is incremented by 1 on each animation frame.
   * When the counter reaches MAX_HOVER_DETECTION_DELAY (default 4), it is reset to 0 and the `findHoveredPoint` or `findHoveredLine` method is executed.
   */
  private _findHoveredItemExecutionCount = 0
  /**
   * If the mouse is not on the Canvas, the `findHoveredPoint` or `findHoveredLine` method will not be executed.
   */
  private _isMouseOnCanvas = false
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
  private isPointClusterUpdateNeeded = false
  private isForceManyBodyUpdateNeeded = false
  private isForceLinkUpdateNeeded = false
  private isForceCenterUpdateNeeded = false
  private isPointImageSizesUpdateNeeded = false

  private _isDestroyed = false

  public constructor (
    div: HTMLDivElement,
    config?: GraphConfigInterface
  ) {
    if (config) this.config.init(config)

    this.store.div = div
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    this.store.div.appendChild(canvas)
    this.addAttribution()
    this.canvas = canvas

    // Start device creation immediately (fire and forget)
    this.deviceInitPromise = this.createDevice(canvas)
      .then(device => {
        if (this._isDestroyed) {
          device.destroy()
          return device
        }
        this.device = device

        const w = canvas.clientWidth
        const h = canvas.clientHeight

        canvas.width = w * this.config.pixelRatio
        canvas.height = h * this.config.pixelRatio

        this.store.adjustSpaceSize(this.config.spaceSize, this.device.limits.maxTextureDimension2D)
        this.store.setWebGLMaxTextureSize(this.device.limits.maxTextureDimension2D)
        this.store.updateScreenSize(w, h)

        this.canvasD3Selection = select<HTMLCanvasElement, undefined>(this.canvas)
        this.canvasD3Selection
          .on('mouseenter.cosmos', () => { this._isMouseOnCanvas = true })
          .on('mousemove.cosmos', () => { this._isMouseOnCanvas = true })
          .on('mouseleave.cosmos', (event) => {
            this._isMouseOnCanvas = false
            this.currentEvent = event

            // Clear point hover state and trigger callback if needed
            if (this.store.hoveredPoint !== undefined && this.config.onPointMouseOut) {
              this.config.onPointMouseOut(event)
            }

            // Clear link hover state and trigger callback if needed
            if (this.store.hoveredLinkIndex !== undefined && this.config.onLinkMouseOut) {
              this.config.onLinkMouseOut(event)
            }

            // Reset right-click flag
            this.isRightClickMouse = false

            // Clear hover states
            this.store.hoveredPoint = undefined
            this.store.hoveredLinkIndex = undefined

            // Update cursor style after clearing hover states
            this.updateCanvasCursor()
          })
        select(document)
          .on('keydown.cosmos', (event) => { if (event.code === 'Space') this.store.isSpaceKeyPressed = true })
          .on('keyup.cosmos', (event) => { if (event.code === 'Space') this.store.isSpaceKeyPressed = false })
        this.zoomInstance.behavior
          .on('start.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => { this.currentEvent = e })
          .on('zoom.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
            const userDriven = !!e.sourceEvent
            if (userDriven) this.updateMousePosition(e.sourceEvent)
            this.currentEvent = e
          })
          .on('end.detect', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => { this.currentEvent = e })
        this.dragInstance.behavior
          .on('start.detect', (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => {
            this.currentEvent = e
            this.updateCanvasCursor()
          })
          .on('drag.detect', (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => {
            if (this.dragInstance.isActive) {
              this.updateMousePosition(e)
            }
            this.currentEvent = e
          })
          .on('end.detect', (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => {
            this.currentEvent = e
            this.updateCanvasCursor()
          })
        this.canvasD3Selection
          .call(this.dragInstance.behavior)
          .call(this.zoomInstance.behavior)
          .on('click', this.onClick.bind(this))
          .on('mousemove', this.onMouseMove.bind(this))
          .on('contextmenu', this.onRightClickMouse.bind(this))
        if (!this.config.enableZoom || !this.config.enableDrag) this.updateZoomDragBehaviors()
        this.setZoomLevel(this.config.initialZoomLevel ?? 1)

        const pointSizeRange = (device as WebGLDevice).gl.getParameter(GL.ALIASED_POINT_SIZE_RANGE) as [number, number]
        this.store.maxPointSize = (pointSizeRange?.[1] ?? MAX_POINT_SIZE) / this.config.pixelRatio

        // Initialize simulation state based on enableSimulation config
        // If simulation is disabled, start with isSimulationRunning = false
        this.store.isSimulationRunning = this.config.enableSimulation

        this.points = new Points(device, this.config, this.store, this.graph)
        this.lines = new Lines(device, this.config, this.store, this.graph, this.points)
        if (this.config.enableSimulation) {
          this.forceGravity = new ForceGravity(device, this.config, this.store, this.graph, this.points)
          this.forceCenter = new ForceCenter(device, this.config, this.store, this.graph, this.points)
          this.forceManyBody = new ForceManyBody(device, this.config, this.store, this.graph, this.points)
          this.forceLinkIncoming = new ForceLink(device, this.config, this.store, this.graph, this.points)
          this.forceLinkOutgoing = new ForceLink(device, this.config, this.store, this.graph, this.points)
          this.forceMouse = new ForceMouse(device, this.config, this.store, this.graph, this.points)
        }
        this.clusters = new Clusters(device, this.config, this.store, this.graph, this.points)

        this.store.backgroundColor = getRgbaColor(this.config.backgroundColor)
        this.store.setHoveredPointRingColor(this.config.hoveredPointRingColor ?? defaultConfigValues.hoveredPointRingColor)
        this.store.setFocusedPointRingColor(this.config.focusedPointRingColor ?? defaultConfigValues.focusedPointRingColor)
        if (this.config.focusedPointIndex !== undefined) {
          this.store.setFocusedPoint(this.config.focusedPointIndex)
        }
        this.store.setGreyoutPointColor(this.config.pointGreyoutColor ?? defaultGreyoutPointColor)
        this.store.setHoveredLinkColor(this.config.hoveredLinkColor ?? defaultConfigValues.hoveredLinkColor)

        this.store.updateLinkHoveringEnabled(this.config)

        if (this.config.showFPSMonitor) this.fpsMonitor = new FPSMonitor(this.canvas)

        if (this.config.randomSeed !== undefined) this.store.addRandomSeed(this.config.randomSeed)

        return device
      })
      .catch(error => {
        console.error('Device initialization failed:', error)
        throw error
      })
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
   * Set or update Cosmos configuration. The changes will be applied in real time.
   * @param config Cosmos configuration object.
   */
  public setConfig (config: Partial<GraphConfigInterface>): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setConfig(config))) return
    const prevConfig = { ...this.config }
    this.config.init(config)
    if ((prevConfig.pointDefaultColor !== this.config.pointDefaultColor) ||
      (prevConfig.pointColor !== this.config.pointColor)) {
      this.graph.updatePointColor()
      this.points?.updateColor()
    }
    if ((prevConfig.pointDefaultSize !== this.config.pointDefaultSize) ||
      (prevConfig.pointSize !== this.config.pointSize)) {
      this.graph.updatePointSize()
      this.points?.updateSize()
    }
    if ((prevConfig.linkDefaultColor !== this.config.linkDefaultColor) ||
      (prevConfig.linkColor !== this.config.linkColor)) {
      this.graph.updateLinkColor()
      this.lines?.updateColor()
    }
    if ((prevConfig.linkDefaultWidth !== this.config.linkDefaultWidth) ||
      (prevConfig.linkWidth !== this.config.linkWidth)) {
      this.graph.updateLinkWidth()
      this.lines?.updateWidth()
    }
    if ((prevConfig.linkDefaultArrows !== this.config.linkDefaultArrows) ||
      (prevConfig.linkArrows !== this.config.linkArrows)) {
      this.graph.updateArrows()
      this.lines?.updateArrow()
    }
    if (prevConfig.curvedLinkSegments !== this.config.curvedLinkSegments ||
      prevConfig.curvedLinks !== this.config.curvedLinks) {
      this.lines?.updateCurveLineGeometry()
    }

    if (prevConfig.backgroundColor !== this.config.backgroundColor) {
      this.store.backgroundColor = getRgbaColor(this.config.backgroundColor ?? defaultBackgroundColor)
    }
    if (prevConfig.hoveredPointRingColor !== this.config.hoveredPointRingColor) {
      this.store.setHoveredPointRingColor(this.config.hoveredPointRingColor ?? defaultConfigValues.hoveredPointRingColor)
    }
    if (prevConfig.focusedPointRingColor !== this.config.focusedPointRingColor) {
      this.store.setFocusedPointRingColor(this.config.focusedPointRingColor ?? defaultConfigValues.focusedPointRingColor)
    }
    if (prevConfig.pointGreyoutColor !== this.config.pointGreyoutColor) {
      this.store.setGreyoutPointColor(this.config.pointGreyoutColor ?? defaultGreyoutPointColor)
    }
    if (prevConfig.hoveredLinkColor !== this.config.hoveredLinkColor) {
      this.store.setHoveredLinkColor(this.config.hoveredLinkColor ?? defaultConfigValues.hoveredLinkColor)
    }
    if (prevConfig.focusedPointIndex !== this.config.focusedPointIndex) {
      this.store.setFocusedPoint(this.config.focusedPointIndex)
    }
    if (prevConfig.pixelRatio !== this.config.pixelRatio) {
      // Update device's canvas context useDevicePixels
      if (this.device?.canvasContext) {
        this.device.canvasContext.setProps({ useDevicePixels: this.config.pixelRatio })

        // Recalculate maxPointSize with new pixelRatio
        const pointSizeRange = (this.device as WebGLDevice).gl.getParameter(GL.ALIASED_POINT_SIZE_RANGE) as [number, number]
        this.store.maxPointSize = (pointSizeRange?.[1] ?? MAX_POINT_SIZE) / this.config.pixelRatio
      }
    }
    if (prevConfig.spaceSize !== this.config.spaceSize) {
      this.store.adjustSpaceSize(this.config.spaceSize, this.device?.limits.maxTextureDimension2D ?? 4096)
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

    if (prevConfig.onLinkClick !== this.config.onLinkClick ||
        prevConfig.onLinkMouseOver !== this.config.onLinkMouseOver ||
        prevConfig.onLinkMouseOut !== this.config.onLinkMouseOut) {
      this.store.updateLinkHoveringEnabled(this.config)
    }
  }

  /**
   * Sets the positions for the graph points.
   *
   * @param {Float32Array} pointPositions - A Float32Array representing the positions of points in the format [x1, y1, x2, y2, ..., xn, yn],
   * where `n` is the index of the point.
   * Example: `new Float32Array([1, 2, 3, 4, 5, 6])` sets the first point to (1, 2), the second point to (3, 4), and so on.
   * @param {boolean | undefined} dontRescale - For this call only, don't rescale the points.
   *   - `true`: Don't rescale.
   *   - `false` or `undefined` (default): Use the behavior defined by `config.rescalePositions`.
   */
  public setPointPositions (pointPositions: Float32Array, dontRescale?: boolean | undefined): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setPointPositions(pointPositions, dontRescale))) return
    this.graph.inputPointPositions = pointPositions
    this.points!.shouldSkipRescale = dontRescale
    this.isPointPositionsUpdateNeeded = true
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
   * Sets the colors for the graph points.
   *
   * @param {Float32Array} pointColors - A Float32Array representing the colors of points in the format [r1, g1, b1, a1, r2, g2, b2, a2, ..., rn, gn, bn, an],
   * where each color is represented in RGBA format.
   * Example: `new Float32Array([255, 0, 0, 1, 0, 255, 0, 1])` sets the first point to red and the second point to green.
  */
  public setPointColors (pointColors: Float32Array): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setPointColors(pointColors))) return
    this.graph.inputPointColors = pointColors
    this.isPointColorUpdateNeeded = true
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
    this.graph.inputLinks = links
    this.isLinksUpdateNeeded = true
    // Links related texture depends on links length, so we need to update it
    this.isLinkColorUpdateNeeded = true
    this.isLinkWidthUpdateNeeded = true
    this.isLinkArrowUpdateNeeded = true
    this.isForceLinkUpdateNeeded = true
  }

  /**
   * Sets the colors for the graph links.
   *
   * @param {Float32Array} linkColors - A Float32Array representing the colors of links in the format [r1, g1, b1, a1, r2, g2, b2, a2, ..., rn, gn, bn, an],
   * where each color is in RGBA format.
   * Example: `new Float32Array([255, 0, 0, 1, 0, 255, 0, 1])` sets the first link to red and the second link to green.
   */
  public setLinkColors (linkColors: Float32Array): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setLinkColors(linkColors))) return
    this.graph.inputLinkColors = linkColors
    this.isLinkColorUpdateNeeded = true
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
   */
  public setClusterPositions (clusterPositions: (number | undefined)[]): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.setClusterPositions(clusterPositions))) return
    this.graph.inputClusterPositions = clusterPositions
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
      }
      return
    }

    // If `initialZoomLevel` is set, we don't need to fit the view
    if (this._isFirstRenderAfterInit && fitViewOnInit && initialZoomLevel === undefined) {
      this._fitViewOnInitTimeoutID = window.setTimeout(() => {
        if (fitViewByPointIndices) this.fitViewByPointIndices(fitViewByPointIndices, fitViewDuration, fitViewPadding)
        else if (fitViewByPointsInRect) this.setZoomTransformByPointPositions(fitViewByPointsInRect, fitViewDuration, undefined, fitViewPadding)
        else this.fitView(fitViewDuration, fitViewPadding)
      }, fitViewDelay)
    }
    // Update graph and start frames
    this.update(simulationAlpha)
    this.startFrames()

    this._isFirstRenderAfterInit = false
  }

  /**
   * Center the view on a point and zoom in, by point index.
   * @param index The index of the point in the array of points.
   * @param duration Duration of the animation transition in milliseconds (`700` by default).
   * @param scale Scale value to zoom in or out (`3` by default).
   * @param canZoomOut Set to `false` to prevent zooming out from the point (`true` by default).
   */
  public zoomToPointByIndex (index: number, duration = 700, scale = defaultScaleToZoom, canZoomOut = true): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.zoomToPointByIndex(index, duration, scale, canZoomOut))) return
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
      this.setZoomTransformByPointPositions([posX, posY], duration, zoomLevel)
    } else {
      const transform = this.zoomInstance.getTransform([[posX, posY]], zoomLevel)
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
   */

  public zoom (value: number, duration = 0): void {
    if (this._isDestroyed) return
    this.setZoomLevel(value, duration)
  }

  /**
   * Zoom the view in or out to the specified zoom level.
   * @param value Zoom level
   * @param duration Duration of the zoom in/out transition.
   */
  public setZoomLevel (value: number, duration = 0): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.setZoomLevel(value, duration))) return

    if (!this.canvasD3Selection) return

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
   * Get current X and Y coordinates of the clusters.
   * @returns Array of point cluster.
   */
  public getClusterPositions (): number[] {
    if (this._isDestroyed || !this.device || !this.clusters) return []
    if (this.graph.pointClusters === undefined || this.clusters.clusterCount === undefined) return []
    this.clusters.calculateCentermass()
    const positions: number[] = []
    const clusterPositionsPixels = readPixels(this.device, this.clusters.centermassFbo as Framebuffer)
    positions.length = this.clusters.clusterCount * 2
    for (let i = 0; i < positions.length / 2; i += 1) {
      const sumX = clusterPositionsPixels[i * 4 + 0]
      const sumY = clusterPositionsPixels[i * 4 + 1]
      const sumN = clusterPositionsPixels[i * 4 + 2]
      if (sumX !== undefined && sumY !== undefined && sumN !== undefined) {
        positions[i * 2] = sumX / sumN
        positions[i * 2 + 1] = sumY / sumN
      }
    }
    return positions
  }

  /**
   * Center and zoom in/out the view to fit all points in the scene.
   * @param duration Duration of the center and zoom in/out animation in milliseconds (`250` by default).
   * @param padding Padding around the viewport in percentage (`0.1` by default).
   */
  public fitView (duration = 250, padding = 0.1): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.fitView(duration, padding))) return

    this.setZoomTransformByPointPositions(this.getPointPositions(), duration, undefined, padding)
  }

  /**
   * Center and zoom in/out the view to fit points by their indices in the scene.
   * @param duration Duration of the center and zoom in/out animation in milliseconds (`250` by default).
   * @param padding Padding around the viewport in percentage
   */
  public fitViewByPointIndices (indices: number[], duration = 250, padding = 0.1): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.fitViewByPointIndices(indices, duration, padding))) return
    const positionsArray = this.getPointPositions()
    const positions = new Array(indices.length * 2)
    for (const [i, index] of indices.entries()) {
      positions[i * 2] = positionsArray[index * 2]
      positions[i * 2 + 1] = positionsArray[index * 2 + 1]
    }
    this.setZoomTransformByPointPositions(positions, duration, undefined, padding)
  }

  /**
   * Center and zoom in/out the view to fit points by their positions in the scene.
   * @param duration Duration of the center and zoom in/out animation in milliseconds (`250` by default).
   * @param padding Padding around the viewport in percentage
   */
  public fitViewByPointPositions (positions: number[], duration = 250, padding = 0.1): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.fitViewByPointPositions(positions, duration, padding))) return

    this.setZoomTransformByPointPositions(positions, duration, undefined, padding)
  }

  /**
   * Get points indices inside a rectangular area.
   * @param selection - Array of two corner points `[[left, top], [right, bottom]]`.
   * The `left` and `right` coordinates should be from 0 to the width of the canvas.
   * The `top` and `bottom` coordinates should be from 0 to the height of the canvas.
   * @returns A Float32Array containing the indices of points inside a rectangular area.
   */
  public getPointsInRect (selection: [[number, number], [number, number]]): Float32Array {
    if (this._isDestroyed || !this.device || !this.points) return new Float32Array()
    const h = this.store.screenSize[1]
    this.store.selectedArea = [[selection[0][0], (h - selection[1][1])], [selection[1][0], (h - selection[0][1])]]
    this.points.findPointsOnAreaSelection()
    const pixels = readPixels(this.device, this.points.selectedFbo as Framebuffer)

    return pixels
      .map((pixel, i) => {
        if (i % 4 === 0 && pixel !== 0) return i / 4
        else return -1
      })
      .filter(d => d !== -1)
  }

  /**
   * Get points indices inside a rectangular area.
   * @param selection - Array of two corner points `[[left, top], [right, bottom]]`.
   * The `left` and `right` coordinates should be from 0 to the width of the canvas.
   * The `top` and `bottom` coordinates should be from 0 to the height of the canvas.
   * @returns A Float32Array containing the indices of points inside a rectangular area.
   * @deprecated Use `getPointsInRect` instead. This method will be removed in a future version.
   */
  public getPointsInRange (selection: [[number, number], [number, number]]): Float32Array {
    return this.getPointsInRect(selection)
  }

  /**
   * Get points indices inside a polygon area.
   * @param polygonPath - Array of points `[[x1, y1], [x2, y2], ..., [xn, yn]]` that defines the polygon.
   * The coordinates should be from 0 to the width/height of the canvas.
   * @returns A Float32Array containing the indices of points inside the polygon area.
   */
  public getPointsInPolygon (polygonPath: [number, number][]): Float32Array {
    if (this._isDestroyed || !this.device || !this.points) return new Float32Array()
    if (polygonPath.length < 3) return new Float32Array() // Need at least 3 points for a polygon

    const h = this.store.screenSize[1]
    // Convert coordinates to WebGL coordinate system (flip Y)
    const convertedPath = polygonPath.map(([x, y]) => [x, h - y] as [number, number])
    this.points.updatePolygonPath(convertedPath)
    this.points.findPointsOnPolygonSelection()
    const pixels = readPixels(this.device, this.points.selectedFbo as Framebuffer)

    return pixels
      .map((pixel, i) => {
        if (i % 4 === 0 && pixel !== 0) return i / 4
        else return -1
      })
      .filter(d => d !== -1)
  }

  /** Select points inside a rectangular area.
   * @param selection - Array of two corner points `[[left, top], [right, bottom]]`.
   * The `left` and `right` coordinates should be from 0 to the width of the canvas.
   * The `top` and `bottom` coordinates should be from 0 to the height of the canvas. */
  public selectPointsInRect (selection: [[number, number], [number, number]] | null): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.selectPointsInRect(selection))) return
    if (!this.device || !this.points) return
    if (selection) {
      const h = this.store.screenSize[1]
      this.store.selectedArea = [[selection[0][0], (h - selection[1][1])], [selection[1][0], (h - selection[0][1])]]
      this.points.findPointsOnAreaSelection()
      const pixels = readPixels(this.device, this.points.selectedFbo as Framebuffer)
      this.store.selectedIndices = pixels
        .map((pixel, i) => {
          if (i % 4 === 0 && pixel !== 0) return i / 4
          else return -1
        })
        .filter(d => d !== -1)
    } else {
      this.store.selectedIndices = null
    }
    this.points.updateGreyoutStatus()
  }

  /** Select points inside a rectangular area.
   * @param selection - Array of two corner points `[[left, top], [right, bottom]]`.
   * The `left` and `right` coordinates should be from 0 to the width of the canvas.
   * The `top` and `bottom` coordinates should be from 0 to the height of the canvas.
   * @deprecated Use `selectPointsInRect` instead. This method will be removed in a future version.
   */
  public selectPointsInRange (selection: [[number, number], [number, number]] | null): void {
    return this.selectPointsInRect(selection)
  }

  /** Select points inside a polygon area.
   * @param polygonPath - Array of points `[[x1, y1], [x2, y2], ..., [xn, yn]]` that defines the polygon.
   * The coordinates should be from 0 to the width/height of the canvas.
   * Set to null to clear selection. */
  public selectPointsInPolygon (polygonPath: [number, number][] | null): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.selectPointsInPolygon(polygonPath))) return
    if (!this.device || !this.points) return
    if (polygonPath) {
      if (polygonPath.length < 3) {
        console.warn('Polygon path requires at least 3 points to form a polygon.')
        return
      }

      const h = this.store.screenSize[1]
      // Convert coordinates to WebGL coordinate system (flip Y)
      const convertedPath = polygonPath.map(([x, y]) => [x, h - y] as [number, number])
      this.points.updatePolygonPath(convertedPath)
      this.points.findPointsOnPolygonSelection()
      const pixels = readPixels(this.device, this.points.selectedFbo as Framebuffer)
      this.store.selectedIndices = pixels
        .map((pixel, i) => {
          if (i % 4 === 0 && pixel !== 0) return i / 4
          else return -1
        })
        .filter(d => d !== -1)
    } else {
      this.store.selectedIndices = null
    }
    this.points.updateGreyoutStatus()
  }

  /**
   * Select a point by index. If you want the adjacent points to get selected too, provide `true` as the second argument.
   * @param index The index of the point in the array of points.
   * @param selectAdjacentPoints When set to `true`, selects adjacent points (`false` by default).
   */
  public selectPointByIndex (index: number, selectAdjacentPoints = false): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.selectPointByIndex(index, selectAdjacentPoints))) return
    if (selectAdjacentPoints) {
      const adjacentIndices = this.graph.getAdjacentIndices(index) ?? []
      this.selectPointsByIndices([index, ...adjacentIndices])
    } else this.selectPointsByIndices([index])
  }

  /**
   * Select multiples points by their indices.
   * @param indices Array of points indices.
   */
  public selectPointsByIndices (indices?: (number | undefined)[] | null): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.selectPointsByIndices(indices))) return
    if (!this.points) return
    if (!indices) {
      this.store.selectedIndices = null
    } else if (indices.length === 0) {
      this.store.selectedIndices = new Float32Array()
    } else {
      this.store.selectedIndices = new Float32Array(indices.filter(d => d !== undefined))
    }

    this.points.updateGreyoutStatus()
  }

  /**
   * Unselect all points.
   */
  public unselectPoints (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.unselectPoints())) return
    if (!this.points) return
    this.store.selectedIndices = null
    this.points.updateGreyoutStatus()
  }

  /**
   * Get indices of points that are currently selected.
   * @returns Array of selected indices of points.
   */
  public getSelectedIndices (): number[] | null {
    if (this._isDestroyed) return null
    const { selectedIndices } = this.store
    if (!selectedIndices) return null
    return Array.from(selectedIndices)
  }

  /**
   * Get indices that are adjacent to a specific point by its index.
   * @param index Index of the point.
   * @returns Array of adjacent indices.
   */

  public getAdjacentIndices (index: number): number[] | undefined {
    if (this._isDestroyed) return undefined
    return this.graph.getAdjacentIndices(index)
  }

  /**
   * Converts the X and Y point coordinates from the space coordinate system to the screen coordinate system.
   * @param spacePosition Array of x and y coordinates in the space coordinate system.
   * @returns Array of x and y coordinates in the screen coordinate system.
   */
  public spaceToScreenPosition (spacePosition: [number, number]): [number, number] {
    if (this._isDestroyed) return [0, 0]
    return this.zoomInstance.convertSpaceToScreenPosition(spacePosition)
  }

  /**
   * Converts the X and Y point coordinates from the screen coordinate system to the space coordinate system.
   * @param screenPosition Array of x and y coordinates in the screen coordinate system.
   * @returns Array of x and y coordinates in the space coordinate system.
   */
  public screenToSpacePosition (screenPosition: [number, number]): [number, number] {
    if (this._isDestroyed) return [0, 0]
    return this.zoomInstance.convertScreenToSpacePosition(screenPosition)
  }

  /**
   * Converts the point radius value from the space coordinate system to the screen coordinate system.
   * @param spaceRadius Radius of point in the space coordinate system.
   * @returns Radius of point in the screen coordinate system.
   */
  public spaceToScreenRadius (spaceRadius: number): number {
    if (this._isDestroyed) return 0
    return this.zoomInstance.convertSpaceToScreenRadius(spaceRadius)
  }

  /**
   * Get point radius by its index.
   * @param index Index of the point.
   * @returns Radius of the point.
   */
  public getPointRadiusByIndex (index: number): number | undefined {
    if (this._isDestroyed) return undefined
    return this.graph.pointSizes?.[index]
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
    return this.points.getSampledPointPositionsMap()
  }

  /**
   * For the points that are currently visible on the screen, get a sample of point indices and positions.
   * The resulting number of points will depend on the `pointSamplingDistance` configuration property,
   * and the sampled points will be evenly distributed.
   * @returns An object containing arrays of point indices and positions.
   */
  public getSampledPoints (): { indices: number[]; positions: number[] } {
    if (this._isDestroyed || !this.points) return { indices: [], positions: [] }
    return this.points.getSampledPoints()
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
   * @param alpha Value from 0 to 1. The higher the value, the more initial energy the simulation will get.
   */
  public start (alpha = 1): void {
    if (this._isDestroyed) return

    if (this.ensureDevice(() => this.start(alpha))) return

    if (!this.graph.pointsNumber) return

    // Always set simulation as running when start() is called
    this.store.isSimulationRunning = true
    this.store.simulationProgress = 0
    this.store.alpha = alpha
    this.config.onSimulationStart?.()

    // Note: Does NOT start frames - that's handled separately
  }

  /**
   * Stop the simulation. This stops the simulation and resets its state.
   * Use start() to begin a new simulation cycle.
   */
  public stop (): void {
    if (this._isDestroyed) return
    this.store.isSimulationRunning = false
    this.store.simulationProgress = 0
    this.store.alpha = 0
    this.config.onSimulationEnd?.()
  }

  /**
   * Pause the simulation. When paused, the simulation stops running
   * but preserves its current state (progress, alpha).
   * Can be resumed using the unpause method.
   */
  public pause (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.pause())) return
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
    this.store.isSimulationRunning = true
    this.config.onSimulationUnpause?.()
  }

  /**
   * Restart/Resume the simulation. This method unpauses a paused
   * simulation and resumes its execution.
   * @deprecated Use `unpause()` instead. This method will be removed in a future version.
   */
  public restart (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.restart())) return
    this.store.isSimulationRunning = true
    this.config.onSimulationRestart?.()
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
  }

  /**
   * Destroy this Cosmos instance.
   */
  public destroy (): void {
    if (this._isDestroyed) return
    window.clearTimeout(this._fitViewOnInitTimeoutID)
    this.stopFrames()

    // Remove all event listeners
    if (this.canvasD3Selection) {
      this.canvasD3Selection
        .on('mouseenter.cosmos', null)
        .on('mousemove.cosmos', null)
        .on('mouseleave.cosmos', null)
        .on('click', null)
        .on('mousemove', null)
        .on('contextmenu', null)
        .on('.drag', null)
        .on('.zoom', null)
    }

    select(document)
      .on('keydown.cosmos', null)
      .on('keyup.cosmos', null)

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
    this.forceMouse?.destroy()

    if (this.device) {
      // Clears the canvas after particle system is destroyed
      const clearPass = this.device.beginRenderPass({
        clearColor: this.store.backgroundColor,
        clearDepth: 1,
        clearStencil: 0,
      })
      clearPass.end()
      this.device.destroy()
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }

    if (this.attributionDivElement && this.attributionDivElement.parentNode) {
      this.attributionDivElement.parentNode.removeChild(this.attributionDivElement)
    }

    document.getElementById('gl-bench-style')?.remove()

    this.canvasD3Selection = undefined
    this.attributionDivElement = undefined

    this._isDestroyed = true
  }

  /**
   * Updates and recreates the graph visualization based on pending changes.
   */
  public create (): void {
    if (this._isDestroyed) return
    if (this.ensureDevice(() => this.create())) return
    if (!this.points) return
    if (!this.lines) return
    if (this.isPointPositionsUpdateNeeded) this.points.updatePositions()
    if (this.isPointColorUpdateNeeded) this.points.updateColor()
    if (this.isPointSizeUpdateNeeded) this.points.updateSize()
    if (this.isPointShapeUpdateNeeded) this.points.updateShape()
    if (this.isPointImageIndicesUpdateNeeded) this.points.updateImageIndices()
    if (this.isPointImageSizesUpdateNeeded) this.points.updateImageSizes()

    if (this.isLinksUpdateNeeded) this.lines.updatePointsBuffer()
    if (this.isLinkColorUpdateNeeded) this.lines.updateColor()
    if (this.isLinkWidthUpdateNeeded) this.lines.updateWidth()
    if (this.isLinkArrowUpdateNeeded) this.lines.updateArrow()

    if (this.isForceManyBodyUpdateNeeded) this.forceManyBody?.create()
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
    this.isPointClusterUpdateNeeded = false
    this.isForceManyBodyUpdateNeeded = false
    this.isForceLinkUpdateNeeded = false
    this.isForceCenterUpdateNeeded = false
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
   * Ensures device is initialized before executing a method.
   * If device is not ready, queues the method to run after initialization.
   * @param callback - Function to execute once device is ready
   * @returns true if device was not ready and operation was queued, false if device is ready
   */
  private ensureDevice (callback: () => void): boolean {
    if (!this.device) {
      this.deviceInitPromise
        .then(() => {
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
    this.store.hoveredPoint = undefined
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
    const { config: { simulationGravity, simulationCenter, enableSimulation }, store: { isSimulationRunning } } = this

    if (!enableSimulation) return

    // Right-click repulsion (runs regardless of isSimulationRunning)
    if (this.isRightClickMouse && this.config.enableRightClickRepulsion) {
      this.forceMouse?.run()
      this.points?.updatePosition()
    }

    // Main simulation forces
    // If forceExecution is true (from step()), always run
    // Otherwise, respect isSimulationRunning and zoom state
    const shouldRunSimulation = forceExecution ||
      (isSimulationRunning && !(this.zoomInstance.isRunning && !this.config.enableSimulationDuringZoom))

    if (shouldRunSimulation) {
      // Clear velocity buffer once per frame before applying forces
      if (this.points?.velocityFbo && !this.points.velocityFbo.destroyed && this.device) {
        const velocityClearPass = this.device.beginRenderPass({
          framebuffer: this.points.velocityFbo,
          clearColor: [0, 0, 0, 0],
        })
        velocityClearPass.end()
      }
      if (simulationGravity) {
        this.forceGravity?.run()
        this.points?.updatePosition()
      }

      if (simulationCenter) {
        this.forceCenter?.run()
        this.points?.updatePosition()
      }

      this.forceManyBody?.run()
      this.points?.updatePosition()

      if (this.store.linksTextureSize) {
        this.forceLinkIncoming?.run()
        this.points?.updatePosition()
        this.forceLinkOutgoing?.run()
        this.points?.updatePosition()
      }

      if (this.graph.pointClusters || this.graph.clusterPositions) {
        this.clusters?.run()
        this.points?.updatePosition()
      }

      // Alpha decay and progress
      this.store.alpha += this.store.addAlpha(this.config.simulationDecay ?? defaultConfigValues.simulation.decay)
      if (this.isRightClickMouse && this.config.enableRightClickRepulsion) {
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
    this.forceMouse?.initPrograms()
    this.clusters.initPrograms()
  }

  /**
   * The rendering loop - schedules itself to run continuously
   */
  private frame (): void {
    if (this._isDestroyed) return

    // Check if simulation should end BEFORE scheduling next frame
    // This prevents one extra frame from running after simulation ends
    const { store: { alpha, isSimulationRunning } } = this
    if (alpha < ALPHA_MIN && isSimulationRunning) {
      this.end()
    }

    this.requestAnimationFrameId = window.requestAnimationFrame((now) => {
      this.renderFrame(now)

      // Continue the loop (even after simulation ends)
      if (!this._isDestroyed) {
        this.frame()
      }
    })
  }

  /**
   * Renders a single frame (the actual rendering logic).
   * This does NOT schedule the next frame.
   */
  private renderFrame (now?: number): void {
    if (this._isDestroyed) return
    if (!this.store.pointsTextureSize) return

    this.fpsMonitor?.begin()
    this.resizeCanvas()
    if (!this.dragInstance.isActive) {
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

      if (shouldDrawLinks) {
        this.lines?.draw(drawRenderPass)
      }

      this.points?.draw(drawRenderPass)

      if (this.dragInstance.isActive) {
        // To prevent the dragged point from suddenly jumping, run the drag function twice
        this.points?.drag()
        this.points?.drag()
        // Update tracked positions after drag, even when simulation is disabled
        this.points?.trackPoints()
      }

      drawRenderPass.end()
      this.device.submit()
    }

    this.fpsMonitor?.end(now ?? performance.now())

    this.currentEvent = undefined
  }

  private stopFrames (): void {
    if (this.requestAnimationFrameId) {
      window.cancelAnimationFrame(this.requestAnimationFrameId)
      this.requestAnimationFrameId = 0 // Reset to 0
    }
  }

  /**
   * Starts continuous rendering
   */
  private startFrames (): void {
    if (this._isDestroyed) return
    this.stopFrames() // Stop any existing rendering
    this.frame() // Start the loop
  }

  /**
   * Called automatically when simulation completes (alpha < ALPHA_MIN).
   * Rendering continues after this is called (for rendering/interaction).
   */
  private end (): void {
    this.store.isSimulationRunning = false
    this.store.simulationProgress = 1
    this.config.onSimulationEnd?.()
  }

  private onClick (event: MouseEvent): void {
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
    this.store.mousePosition = this.zoomInstance.convertScreenToSpacePosition([mouseX, mouseY])
    this.store.screenMousePosition = [mouseX, (this.store.screenSize[1] - mouseY)]
  }

  private onMouseMove (event: MouseEvent): void {
    this.currentEvent = event
    this.updateMousePosition(event)
    this.isRightClickMouse = event.which === 3
    this.config.onMouseMove?.(
      this.store.hoveredPoint?.index,
      this.store.hoveredPoint?.position,
      this.currentEvent
    )
  }

  private onRightClickMouse (event: MouseEvent): void {
    event.preventDefault()
  }

  private resizeCanvas (forceResize = false): void {
    if (this._isDestroyed) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const [prevW, prevH] = this.store.screenSize

    // Check if CSS size changed (luma.gl's autoResize handles canvas.width/height automatically)
    if (forceResize || prevW !== w || prevH !== h) {
      const { k } = this.zoomInstance.eventTransform
      const centerPosition = this.zoomInstance.convertScreenToSpacePosition([prevW / 2, prevH / 2])

      this.store.updateScreenSize(w, h)
      // Note: canvas.width and canvas.height are managed by luma.gl's autoResize
      // We only update our internal state and dependent components
      this.canvasD3Selection
        ?.call(this.zoomInstance.behavior.transform, this.zoomInstance.getTransform([centerPosition], k))
      this.points?.updateSampledPointsGrid()
      // Only update link index FBO if link hovering is enabled
      if (this.store.isLinkHoveringEnabled) {
        this.lines?.updateLinkIndexFbo()
      }
    }
  }

  private setZoomTransformByPointPositions (positions: number[], duration = 250, scale?: number, padding?: number): void {
    this.resizeCanvas()
    const transform = this.zoomInstance.getTransform(this.pair(positions), scale, padding)
    this.canvasD3Selection
      ?.transition()
      .ease(easeQuadInOut)
      .duration(duration)
      .call(this.zoomInstance.behavior.transform, transform)
  }

  private updateZoomDragBehaviors (): void {
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
    }
  }

  private findHoveredItem (): void {
    if (this._isDestroyed || !this._isMouseOnCanvas) return
    if (this._findHoveredItemExecutionCount < MAX_HOVER_DETECTION_DELAY) {
      this._findHoveredItemExecutionCount += 1
      return
    }
    this._findHoveredItemExecutionCount = 0
    this.findHoveredPoint()

    if (this.graph.linksNumber && this.store.isLinkHoveringEnabled) {
      this.findHoveredLine()
    } else if (this.store.hoveredLinkIndex !== undefined) {
      // Clear stale hoveredLinkIndex when there are no links
      const wasHovered = this.store.hoveredLinkIndex !== undefined
      this.store.hoveredLinkIndex = undefined
      if (wasHovered && this.config.onLinkMouseOut) {
        this.config.onLinkMouseOut(this.currentEvent)
      }
    }

    this.updateCanvasCursor()
  }

  private findHoveredPoint (): void {
    if (this._isDestroyed || !this.device || !this.points) return
    this.points.findHoveredPoint()
    let isMouseover = false
    let isMouseout = false
    const pixels = readPixels(this.device, this.points.hoveredFbo as Framebuffer, 0, 0, 2, 2)
    // Shader writes: rgba = vec4(index, size, pointPosition.xy)
    const hoveredIndex = pixels[0] as number
    const pointSize = pixels[1] as number
    const pointX = pixels[2] as number
    const pointY = pixels[3] as number

    if (pointSize > 0) {
      if (this.store.hoveredPoint === undefined || this.store.hoveredPoint.index !== hoveredIndex) {
        isMouseover = true
      }
      this.store.hoveredPoint = {
        index: hoveredIndex,
        position: [pointX, pointY],
      }
    } else {
      if (this.store.hoveredPoint) isMouseout = true
      this.store.hoveredPoint = undefined
    }

    if (isMouseover && this.store.hoveredPoint) {
      this.config.onPointMouseOver?.(
        this.store.hoveredPoint.index,
        this.store.hoveredPoint.position,
        this.currentEvent
      )
    }
    if (isMouseout) this.config.onPointMouseOut?.(this.currentEvent)
  }

  private findHoveredLine (): void {
    if (this._isDestroyed || !this.lines) return
    if (this.store.hoveredPoint) {
      if (this.store.hoveredLinkIndex !== undefined) {
        this.store.hoveredLinkIndex = undefined
        this.config.onLinkMouseOut?.(this.currentEvent)
      }
      return
    }
    this.lines.findHoveredLine()
    let isMouseover = false
    let isMouseout = false

    if (!this.device) return
    const pixels = readPixels(this.device, this.lines.hoveredLineIndexFbo!)
    const hoveredLineIndex = pixels[0] as number

    if (hoveredLineIndex >= 0) {
      if (this.store.hoveredLinkIndex !== hoveredLineIndex) isMouseover = true
      this.store.hoveredLinkIndex = hoveredLineIndex
    } else {
      if (this.store.hoveredLinkIndex !== undefined) isMouseout = true
      this.store.hoveredLinkIndex = undefined
    }

    if (isMouseover && this.store.hoveredLinkIndex !== undefined) {
      this.config.onLinkMouseOver?.(this.store.hoveredLinkIndex)
    }
    if (isMouseout) this.config.onLinkMouseOut?.(this.currentEvent)
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

export type { GraphConfigInterface } from './config'
export { PointShape } from './modules/GraphData'

export * from './helper'
