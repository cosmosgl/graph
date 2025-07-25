import { select, Selection } from 'd3-selection'
import 'd3-transition'
import { easeQuadInOut, easeQuadIn, easeQuadOut } from 'd3-ease'
import { D3ZoomEvent } from 'd3-zoom'
import { D3DragEvent } from 'd3-drag'
import regl from 'regl'
import { GraphConfig, GraphConfigInterface } from '@/graph/config'
import { getRgbaColor, readPixels, sanitizeHtml } from '@/graph/helper'
import { ForceCenter } from '@/graph/modules/ForceCenter'
import { ForceGravity } from '@/graph/modules/ForceGravity'
import { ForceLink, LinkDirection } from '@/graph/modules/ForceLink'
import { ForceManyBody } from '@/graph/modules/ForceManyBody'
import { ForceManyBodyQuadtree } from '@/graph/modules/ForceManyBodyQuadtree'
import { ForceMouse } from '@/graph/modules/ForceMouse'
import { Clusters } from '@/graph/modules/Clusters'
import { FPSMonitor } from '@/graph/modules/FPSMonitor'
import { GraphData } from '@/graph/modules/GraphData'
import { Lines } from '@/graph/modules/Lines'
import { Points } from '@/graph/modules/Points'
import { Store, ALPHA_MIN, MAX_POINT_SIZE, type Hovered } from '@/graph/modules/Store'
import { Zoom } from '@/graph/modules/Zoom'
import { Drag } from '@/graph/modules/Drag'
import { defaultConfigValues, defaultScaleToZoom } from '@/graph/variables'
import { createWebGLErrorMessage } from './graph/utils/error-message'

export class Graph {
  public config = new GraphConfig()
  public graph = new GraphData(this.config)
  private canvas: HTMLCanvasElement
  private attributionDivElement: HTMLElement | undefined
  private canvasD3Selection: Selection<HTMLCanvasElement, undefined, null, undefined> | undefined
  private reglInstance: regl.Regl | undefined
  private requestAnimationFrameId = 0
  private isRightClickMouse = false

  private store = new Store()
  private points: Points | undefined
  private lines: Lines | undefined
  private forceGravity: ForceGravity | undefined
  private forceCenter: ForceCenter | undefined
  private forceManyBody: ForceManyBody | ForceManyBodyQuadtree | undefined
  private forceLinkIncoming: ForceLink | undefined
  private forceLinkOutgoing: ForceLink | undefined
  private forceMouse: ForceMouse | undefined
  private clusters: Clusters | undefined
  private zoomInstance = new Zoom(this.store, this.config)
  private dragInstance = new Drag(this.store, this.config)

  private fpsMonitor: FPSMonitor | undefined

  private currentEvent: D3ZoomEvent<HTMLCanvasElement, undefined> | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | MouseEvent | undefined
  /**
   * The value of `_findHoveredPointExecutionCount` is incremented by 1 on each animation frame.
   * When the counter reaches 2 (or more), it is reset to 0 and the `findHoveredPoint` method is executed.
   */
  private _findHoveredPointExecutionCount = 0
  /**
   * If the mouse is not on the Canvas, the `findHoveredPoint` method will not be executed.
   */
  private _isMouseOnCanvas = false
  /**
   * After setting data and render graph at a first time, the fit logic will run
   * */
  private _isFirstRenderAfterInit = true
  private _fitViewOnInitTimeoutID: number | undefined

  private _needsPointPositionsUpdate = false
  private _needsPointColorUpdate = false
  private _needsPointSizeUpdate = false
  private _needsPointShapeUpdate = false
  private _needsLinksUpdate = false
  private _needsLinkColorUpdate = false
  private _needsLinkWidthUpdate = false
  private _needsLinkArrowUpdate = false
  private _needsPointClusterUpdate = false
  private _needsForceManyBodyUpdate = false
  private _needsForceLinkUpdate = false
  private _needsForceCenterUpdate = false

  private _isDestroyed = false

  public constructor (div: HTMLDivElement, config?: GraphConfigInterface) {
    if (config) this.config.init(config)

    this.store.div = div
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    this.store.div.appendChild(canvas)
    this.addAttribution()
    const w = canvas.clientWidth
    const h = canvas.clientHeight

    canvas.width = w * this.config.pixelRatio
    canvas.height = h * this.config.pixelRatio

    this.canvas = canvas

    let reglInstance: regl.Regl | undefined
    try {
      reglInstance = regl({
        canvas: this.canvas,
        attributes: {
          antialias: false,
          preserveDrawingBuffer: true,
        },
        extensions: ['OES_texture_float', 'ANGLE_instanced_arrays'],
      })
    } catch (e) {
      createWebGLErrorMessage(this.store.div)
      this._isDestroyed = true
      return
    }
    this.reglInstance = reglInstance

    this.store.adjustSpaceSize(this.config.spaceSize, this.reglInstance.limits.maxTextureSize)
    this.store.updateScreenSize(w, h)

    this.canvasD3Selection = select<HTMLCanvasElement, undefined>(this.canvas)
    this.canvasD3Selection
      .on('mouseenter.cosmos', () => { this._isMouseOnCanvas = true })
      .on('mousemove.cosmos', () => { this._isMouseOnCanvas = true })
      .on('mouseleave.cosmos', () => { this._isMouseOnCanvas = false })
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

    this.store.maxPointSize = (this.reglInstance.limits.pointSizeDims[1] ?? MAX_POINT_SIZE) / this.config.pixelRatio

    this.points = new Points(this.reglInstance, this.config, this.store, this.graph)
    this.lines = new Lines(this.reglInstance, this.config, this.store, this.graph, this.points)
    if (this.config.enableSimulation) {
      this.forceGravity = new ForceGravity(this.reglInstance, this.config, this.store, this.graph, this.points)
      this.forceCenter = new ForceCenter(this.reglInstance, this.config, this.store, this.graph, this.points)
      this.forceManyBody = this.config.useClassicQuadtree
        ? new ForceManyBodyQuadtree(this.reglInstance, this.config, this.store, this.graph, this.points)
        : new ForceManyBody(this.reglInstance, this.config, this.store, this.graph, this.points)
      this.forceLinkIncoming = new ForceLink(this.reglInstance, this.config, this.store, this.graph, this.points)
      this.forceLinkOutgoing = new ForceLink(this.reglInstance, this.config, this.store, this.graph, this.points)
      this.forceMouse = new ForceMouse(this.reglInstance, this.config, this.store, this.graph, this.points)
    }
    this.clusters = new Clusters(this.reglInstance, this.config, this.store, this.graph, this.points)

    this.store.backgroundColor = getRgbaColor(this.config.backgroundColor)
    if (this.config.hoveredPointRingColor) {
      this.store.setHoveredPointRingColor(this.config.hoveredPointRingColor)
    }
    if (this.config.focusedPointRingColor) {
      this.store.setFocusedPointRingColor(this.config.focusedPointRingColor)
    }
    if (this.config.focusedPointIndex !== undefined) {
      this.store.setFocusedPoint(this.config.focusedPointIndex)
    }
    if (this.config.pointGreyoutColor) {
      this.store.setGreyoutPointColor(this.config.pointGreyoutColor)
    }

    if (this.config.showFPSMonitor) this.fpsMonitor = new FPSMonitor(this.canvas)

    if (this.config.randomSeed !== undefined) this.store.addRandomSeed(this.config.randomSeed)
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
    if (this._isDestroyed || !this.reglInstance || !this.points || !this.lines || !this.clusters) return
    const prevConfig = { ...this.config }
    this.config.init(config)
    if (prevConfig.pointColor !== this.config.pointColor) {
      this.graph.updatePointColor()
      this.points.updateColor()
    }
    if (prevConfig.pointSize !== this.config.pointSize) {
      this.graph.updatePointSize()
      this.points.updateSize()
    }
    if (prevConfig.linkColor !== this.config.linkColor) {
      this.graph.updateLinkColor()
      this.lines.updateColor()
    }
    if (prevConfig.linkWidth !== this.config.linkWidth) {
      this.graph.updateLinkWidth()
      this.lines.updateWidth()
    }
    if (prevConfig.linkArrows !== this.config.linkArrows) {
      this.graph.updateArrows()
      this.lines.updateArrow()
    }
    if (prevConfig.curvedLinkSegments !== this.config.curvedLinkSegments ||
      prevConfig.curvedLinks !== this.config.curvedLinks) {
      this.lines.updateCurveLineGeometry()
    }
    if (prevConfig.backgroundColor !== this.config.backgroundColor) this.store.backgroundColor = getRgbaColor(this.config.backgroundColor)
    if (prevConfig.hoveredPointRingColor !== this.config.hoveredPointRingColor) {
      this.store.setHoveredPointRingColor(this.config.hoveredPointRingColor)
    }
    if (prevConfig.focusedPointRingColor !== this.config.focusedPointRingColor) {
      this.store.setFocusedPointRingColor(this.config.focusedPointRingColor)
    }
    if (prevConfig.pointGreyoutColor !== this.config.pointGreyoutColor) {
      this.store.setGreyoutPointColor(this.config.pointGreyoutColor)
    }
    if (prevConfig.focusedPointIndex !== this.config.focusedPointIndex) {
      this.store.setFocusedPoint(this.config.focusedPointIndex)
    }
    if (prevConfig.spaceSize !== this.config.spaceSize ||
      prevConfig.simulationRepulsionQuadtreeLevels !== this.config.simulationRepulsionQuadtreeLevels) {
      this.store.adjustSpaceSize(this.config.spaceSize, this.reglInstance.limits.maxTextureSize)
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
    if (prevConfig.pixelRatio !== this.config.pixelRatio) {
      this.store.maxPointSize = (this.reglInstance.limits.pointSizeDims[1] ?? MAX_POINT_SIZE) / this.config.pixelRatio
    }

    if (prevConfig.enableZoom !== this.config.enableZoom || prevConfig.enableDrag !== this.config.enableDrag) {
      this.updateZoomDragBehaviors()
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
    if (this._isDestroyed || !this.points) return
    this.graph.inputPointPositions = pointPositions
    this.points.dontRescale = dontRescale
    this._needsPointPositionsUpdate = true
    // Links related texture depends on point positions, so we need to update it
    this._needsLinksUpdate = true
    // Point related textures depend on point positions length, so we need to update them
    this._needsPointColorUpdate = true
    this._needsPointSizeUpdate = true
    this._needsPointShapeUpdate = true
    this._needsPointClusterUpdate = true
    this._needsForceManyBodyUpdate = true
    this._needsForceLinkUpdate = true
    this._needsForceCenterUpdate = true
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
    this.graph.inputPointColors = pointColors
    this._needsPointColorUpdate = true
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
    this.graph.inputPointSizes = pointSizes
    this._needsPointSizeUpdate = true
  }

  /**
   * Sets the shapes for the graph points.
   *
   * @param {Float32Array} pointShapes - A Float32Array representing the shapes of points in the format [shape1, shape2, ..., shapen],
   * where `n` is the index of the point and each shape value corresponds to a PointShape enum:
   * 0 = Circle, 1 = Square, 2 = Triangle, 3 = Diamond, 4 = Pentagon, 5 = Hexagon, 6 = Star, 7 = Cross.
   * Example: `new Float32Array([0, 1, 2])` sets the first point to Circle, the second point to Square, and the third point to Triangle.
   */
  public setPointShapes (pointShapes: Float32Array): void {
    if (this._isDestroyed) return
    this.graph.inputPointShapes = pointShapes
    this._needsPointShapeUpdate = true
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
    this.graph.inputLinks = links
    this._needsLinksUpdate = true
    // Links related texture depends on links length, so we need to update it
    this._needsLinkColorUpdate = true
    this._needsLinkWidthUpdate = true
    this._needsLinkArrowUpdate = true
    this._needsForceLinkUpdate = true
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
    this.graph.inputLinkColors = linkColors
    this._needsLinkColorUpdate = true
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
    this.graph.inputLinkWidths = linkWidths
    this._needsLinkWidthUpdate = true
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
    this.graph.linkArrowsBoolean = linkArrows
    this._needsLinkArrowUpdate = true
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
    this.graph.inputLinkStrength = linkStrength
    this._needsForceLinkUpdate = true
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
    this.graph.inputPointClusters = pointClusters
    this._needsPointClusterUpdate = true
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
    this.graph.inputClusterPositions = clusterPositions
    this._needsPointClusterUpdate = true
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
    this.graph.inputClusterStrength = clusterStrength
    this._needsPointClusterUpdate = true
  }

  /**
   * Renders the graph.
   *
   * @param {number} [simulationAlpha] - Optional value between 0 and 1
   * that controls the initial energy of the simulation.The higher the value,
   * the more initial energy the simulation will get. Zero value stops the simulation.
   */
  public render (simulationAlpha?: number): void {
    if (this._isDestroyed || !this.reglInstance) return
    this.graph.update()
    const { fitViewOnInit, fitViewDelay, fitViewPadding, fitViewDuration, fitViewByPointsInRect, fitViewByPointIndices, initialZoomLevel } = this.config
    if (!this.graph.pointsNumber && !this.graph.linksNumber) {
      this.stopFrames()
      select(this.canvas).style('cursor', null)
      this.reglInstance.clear({
        color: this.store.backgroundColor,
        depth: 1,
        stencil: 0,
      })
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
    this._isFirstRenderAfterInit = false

    this.update(simulationAlpha)
  }

  /**
   * Center the view on a point and zoom in, by point index.
   * @param index The index of the point in the array of points.
   * @param duration Duration of the animation transition in milliseconds (`700` by default).
   * @param scale Scale value to zoom in or out (`3` by default).
   * @param canZoomOut Set to `false` to prevent zooming out from the point (`true` by default).
   */
  public zoomToPointByIndex (index: number, duration = 700, scale = defaultScaleToZoom, canZoomOut = true): void {
    if (this._isDestroyed || !this.reglInstance || !this.points || !this.canvasD3Selection) return
    const { store: { screenSize } } = this
    const positionPixels = readPixels(this.reglInstance, this.points.currentPositionFbo as regl.Framebuffer2D)
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
    if (this._isDestroyed || !this.canvasD3Selection) return
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
    if (this._isDestroyed || !this.reglInstance || !this.points) return []
    if (this.graph.pointsNumber === undefined) return []
    const positions: number[] = []
    const pointPositionsPixels = readPixels(this.reglInstance, this.points.currentPositionFbo as regl.Framebuffer2D)
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
    if (this._isDestroyed || !this.reglInstance || !this.clusters) return []
    if (this.graph.pointClusters === undefined || this.clusters.clusterCount === undefined) return []
    this.clusters.calculateCentermass()
    const positions: number[] = []
    const clusterPositionsPixels = readPixels(this.reglInstance, this.clusters.centermassFbo as regl.Framebuffer2D)
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
    this.setZoomTransformByPointPositions(this.getPointPositions(), duration, undefined, padding)
  }

  /**
   * Center and zoom in/out the view to fit points by their indices in the scene.
   * @param duration Duration of the center and zoom in/out animation in milliseconds (`250` by default).
   * @param padding Padding around the viewport in percentage
   */
  public fitViewByPointIndices (indices: number[], duration = 250, padding = 0.1): void {
    if (this._isDestroyed) return
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
    if (this._isDestroyed || !this.reglInstance || !this.points) return new Float32Array()
    const h = this.store.screenSize[1]
    this.store.selectedArea = [[selection[0][0], (h - selection[1][1])], [selection[1][0], (h - selection[0][1])]]
    this.points.findPointsOnAreaSelection()
    const pixels = readPixels(this.reglInstance, this.points.selectedFbo as regl.Framebuffer2D)

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
    if (this._isDestroyed || !this.reglInstance || !this.points) return new Float32Array()
    if (polygonPath.length < 3) return new Float32Array() // Need at least 3 points for a polygon

    const h = this.store.screenSize[1]
    // Convert coordinates to WebGL coordinate system (flip Y)
    const convertedPath = polygonPath.map(([x, y]) => [x, h - y] as [number, number])
    this.points.updatePolygonPath(convertedPath)
    this.points.findPointsOnPolygonSelection()
    const pixels = readPixels(this.reglInstance, this.points.selectedFbo as regl.Framebuffer2D)

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
    if (this._isDestroyed || !this.reglInstance || !this.points) return
    if (selection) {
      const h = this.store.screenSize[1]
      this.store.selectedArea = [[selection[0][0], (h - selection[1][1])], [selection[1][0], (h - selection[0][1])]]
      this.points.findPointsOnAreaSelection()
      const pixels = readPixels(this.reglInstance, this.points.selectedFbo as regl.Framebuffer2D)
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
    if (this._isDestroyed || !this.reglInstance || !this.points) return
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
      const pixels = readPixels(this.reglInstance, this.points.selectedFbo as regl.Framebuffer2D)
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
    if (this._isDestroyed || !this.points) return
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
    if (this._isDestroyed || !this.points) return
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
    if (this._isDestroyed || !this.points) return
    this.points.trackPointsByIndices(indices)
  }

  /**
   * Get current X and Y coordinates of the tracked points.
   * @returns A Map object where keys are the indices of the points and values are their corresponding X and Y coordinates in the [number, number] format.
   */
  public getTrackedPointPositionsMap (): Map<number, [number, number]> {
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
   * @param alpha Value from 0 to 1. The higher the value, the more initial energy the simulation will get.
   */
  public start (alpha = 1): void {
    if (this._isDestroyed) return
    if (!this.graph.pointsNumber) return

    // Only start the simulation if alpha > 0
    if (alpha > 0) {
      this.store.isSimulationRunning = true
      this.store.simulationProgress = 0
      this.config.onSimulationStart?.()
    }

    this.store.alpha = alpha
    this.stopFrames()
    this.frame()
  }

  /**
   * Pause the simulation.
   */
  public pause (): void {
    if (this._isDestroyed) return
    this.store.isSimulationRunning = false
    this.config.onSimulationPause?.()
  }

  /**
   * Restart the simulation.
   */
  public restart (): void {
    if (this._isDestroyed) return
    this.store.isSimulationRunning = true
    this.config.onSimulationRestart?.()
  }

  /**
   * Render only one frame of the simulation (stops the simulation if it was running).
   */
  public step (): void {
    if (this._isDestroyed) return
    this.store.isSimulationRunning = false
    this.stopFrames()
    this.frame()
  }

  /**
   * Destroy this Cosmos instance.
   */
  public destroy (): void {
    if (this._isDestroyed || !this.reglInstance) return
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
    this.reglInstance.destroy()
    // Clears the canvas after particle system is destroyed
    this.reglInstance.clear({
      color: this.store.backgroundColor,
      depth: 1,
      stencil: 0,
    })

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }

    if (this.attributionDivElement && this.attributionDivElement.parentNode) {
      this.attributionDivElement.parentNode.removeChild(this.attributionDivElement)
    }

    document.getElementById('gl-bench-style')?.remove()

    this.canvasD3Selection = undefined
    this.reglInstance = undefined
    this.attributionDivElement = undefined

    this._isDestroyed = true
  }

  /**
   * Updates and recreates the graph visualization based on pending changes.
   */
  public create (): void {
    if (this._isDestroyed || !this.points || !this.lines) return
    if (this._needsPointPositionsUpdate) this.points.updatePositions()
    if (this._needsPointColorUpdate) this.points.updateColor()
    if (this._needsPointSizeUpdate) this.points.updateSize()
    if (this._needsPointShapeUpdate) this.points.updateShape()

    if (this._needsLinksUpdate) this.lines.updatePointsBuffer()
    if (this._needsLinkColorUpdate) this.lines.updateColor()
    if (this._needsLinkWidthUpdate) this.lines.updateWidth()
    if (this._needsLinkArrowUpdate) this.lines.updateArrow()

    if (this._needsForceManyBodyUpdate) this.forceManyBody?.create()
    if (this._needsForceLinkUpdate) {
      this.forceLinkIncoming?.create(LinkDirection.INCOMING)
      this.forceLinkOutgoing?.create(LinkDirection.OUTGOING)
    }
    if (this._needsForceCenterUpdate) this.forceCenter?.create()
    if (this._needsPointClusterUpdate) this.clusters?.create()

    this._needsPointPositionsUpdate = false
    this._needsPointColorUpdate = false
    this._needsPointSizeUpdate = false
    this._needsPointShapeUpdate = false
    this._needsLinksUpdate = false
    this._needsLinkColorUpdate = false
    this._needsLinkWidthUpdate = false
    this._needsLinkArrowUpdate = false
    this._needsPointClusterUpdate = false
    this._needsForceManyBodyUpdate = false
    this._needsForceLinkUpdate = false
    this._needsForceCenterUpdate = false
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

  private update (simulationAlpha = this.store.alpha): void {
    const { graph } = this
    this.store.pointsTextureSize = Math.ceil(Math.sqrt(graph.pointsNumber ?? 0))
    this.store.linksTextureSize = Math.ceil(Math.sqrt((graph.linksNumber ?? 0) * 2))
    this.create()
    this.initPrograms()
    this.store.hoveredPoint = undefined
    this.start(simulationAlpha)
  }

  private initPrograms (): void {
    if (this._isDestroyed || !this.points || !this.lines || !this.clusters) return
    this.points.initPrograms()
    this.lines.initPrograms()
    this.forceGravity?.initPrograms()
    this.forceLinkIncoming?.initPrograms()
    this.forceLinkOutgoing?.initPrograms()
    this.forceMouse?.initPrograms()
    this.forceManyBody?.initPrograms()
    this.forceCenter?.initPrograms()
    this.clusters.initPrograms()
  }

  private frame (): void {
    const { config: { simulationGravity, simulationCenter, renderLinks, enableSimulation }, store: { alpha, isSimulationRunning } } = this
    if (alpha < ALPHA_MIN && isSimulationRunning) this.end()
    if (!this.store.pointsTextureSize) return

    this.requestAnimationFrameId = window.requestAnimationFrame((now) => {
      this.fpsMonitor?.begin()
      this.resizeCanvas()
      if (!this.dragInstance.isActive) this.findHoveredPoint()

      if (enableSimulation) {
        if (this.isRightClickMouse && this.config.enableRightClickRepulsion) {
          this.forceMouse?.run()
          this.points?.updatePosition()
        }
        if ((isSimulationRunning && !(this.zoomInstance.isRunning && !this.config.enableSimulationDuringZoom))) {
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

          this.store.alpha += this.store.addAlpha(this.config.simulationDecay ?? defaultConfigValues.simulation.decay)
          if (this.isRightClickMouse && this.config.enableRightClickRepulsion) this.store.alpha = Math.max(this.store.alpha, 0.1)
          this.store.simulationProgress = Math.sqrt(Math.min(1, ALPHA_MIN / this.store.alpha))
          this.config.onSimulationTick?.(
            this.store.alpha,
            this.store.hoveredPoint?.index,
            this.store.hoveredPoint?.position
          )
        }

        this.points?.trackPoints()
      }

      // Clear canvas
      this.reglInstance?.clear({
        color: this.store.backgroundColor,
        depth: 1,
        stencil: 0,
      })

      if (renderLinks && this.store.linksTextureSize) {
        this.lines?.draw()
      }

      this.points?.draw()
      if (this.dragInstance.isActive) {
        // To prevent the dragged point from suddenly jumping, run the drag function twice
        this.points?.drag()
        this.points?.drag()
      }
      this.fpsMonitor?.end(now)

      this.currentEvent = undefined
      this.frame()
    })
  }

  private stopFrames (): void {
    if (this.requestAnimationFrameId) window.cancelAnimationFrame(this.requestAnimationFrameId)
  }

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
    const prevWidth = this.canvas.width
    const prevHeight = this.canvas.height
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight

    if (forceResize || prevWidth !== w * this.config.pixelRatio || prevHeight !== h * this.config.pixelRatio) {
      const [prevW, prevH] = this.store.screenSize
      const { k } = this.zoomInstance.eventTransform
      const centerPosition = this.zoomInstance.convertScreenToSpacePosition([prevW / 2, prevH / 2])

      this.store.updateScreenSize(w, h)
      this.canvas.width = w * this.config.pixelRatio
      this.canvas.height = h * this.config.pixelRatio
      this.reglInstance?.poll()
      this.canvasD3Selection
        ?.call(this.zoomInstance.behavior.transform, this.zoomInstance.getTransform([centerPosition], k))
      this.points?.updateSampledPointsGrid()
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

  private findHoveredPoint (): void {
    if (!this._isMouseOnCanvas || !this.reglInstance || !this.points) return
    if (this._findHoveredPointExecutionCount < 2) {
      this._findHoveredPointExecutionCount += 1
      return
    }
    this._findHoveredPointExecutionCount = 0
    this.points.findHoveredPoint()
    let isMouseover = false
    let isMouseout = false
    const pixels = readPixels(this.reglInstance, this.points.hoveredFbo as regl.Framebuffer2D)
    const pointSize = pixels[1] as number
    if (pointSize) {
      const hoveredIndex = pixels[0] as number
      if (this.store.hoveredPoint?.index !== hoveredIndex) isMouseover = true
      const pointX = pixels[2] as number
      const pointY = pixels[3] as number
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
    this.updateCanvasCursor()
  }

  private updateCanvasCursor (): void {
    const { hoveredPointCursor } = this.config
    if (this.dragInstance.isActive) select(this.canvas).style('cursor', 'grabbing')
    else if (this.store.hoveredPoint) {
      if (!this.config.enableDrag || this.store.isSpaceKeyPressed) select(this.canvas).style('cursor', hoveredPointCursor)
      else select(this.canvas).style('cursor', 'grab')
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
