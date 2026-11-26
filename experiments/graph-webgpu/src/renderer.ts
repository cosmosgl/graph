import {
  Buffer, Texture, type CommandEncoder, type Device, type Framebuffer, type RenderPass, type ShaderLayout,
  type TextureFormatColor, type TextureFormatDepthStencil, type VertexArray,
} from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '../../../src/config'
import { getRgbaColor } from '../../../src/helper'
import type { GraphData } from '../../../src/modules/GraphData'
import { PICKING_WINDOW_SIZE } from '../../../src/modules/Points/picking-constants'
import { getPickingBufferSize, getPickingWindow, resolveNearestPickedPoint, type PickingWindow } from '../../../src/modules/Points/picking-utils'
import { focusedPointRingOpacity, hoveredPointRingOpacity } from '../../../src/variables'
import { Lines } from './modules/Lines'
import { updateStyleBuffer } from './modules/Shared/style-buffer'
import { hasOnlyDefaultPointStyles, Points, pointStride, shadeDirection, type PointChannels } from './modules/Points'
import { estimateOpaqueArea } from './modules/Points/occlusion'
import { interruptedPointTable, readPointStyle } from './modules/Points/style-table'
import { PointHighlightPass, PointHighlightMask } from './modules/Points/highlights'
import { StyleTransition } from './style-transition'
import { captureSizes, displayedSize, type SizeValues } from './size-transition'
import { PointerCandidates } from './pointer-candidates'
import records from './style-records.wgsl?raw'
import common from './draw-common.wgsl?raw'
import applePointCoordinates from './modules/Points/apple-point-coordinates.wgsl?raw'
import shapes from './modules/Points/point-shapes.wgsl?raw'
import points from './modules/Points/draw-points.wgsl?raw'
import pointRings from './modules/Points/draw-highlighted.wgsl?raw'
import pickWindow from './modules/Points/pick-window.wgsl?raw'
import links from './modules/Lines/draw-links.wgsl?raw'

export interface GraphView {
  width: number;
  height: number;
  pixelRatio: number;
  scale: number;
  /** Translation in CSS pixels. Screen coordinates are (x + worldX * scale, y - worldY * scale). */
  x: number;
  y: number;
  hoveredPoint?: number;
  hostHoveredPoint?: number;
  hoveredLink?: number;
  /** Eased interpolation factor supplied by the Graph animation clock. */
  styleProgress?: number;
  /** Retained position-transition source. Absent destination slots may still be visible here. */
  previousPositions?: Buffer;
  /** Shared Zoom projection from normalized world positions to clip space. */
  pointProjection?: {
    origin: readonly [number, number];
    transform: readonly [number, number, number, number]; // x/y scale and x/y translation
  };
}

export interface GraphDrawOptions {
  points?: boolean;
  links?: boolean;
  /** Backing pixels per CSS pixel in the host viewport. Defaults to the Graph's pixelRatio. */
  pixelRatio?: number;
  picking?: { alpha: number; linkIndexOffset?: number };
}

export interface GraphPick {
  kind: 'point' | 'link';
  index: number;
}

type Rgba = [number, number, number, number]
type PositionSource = { buffer: Buffer; pointCount: number }
type DrawKind = 'point' | 'pointRing' | 'pointerPoint' | 'link' | 'solidLink' | 'uniformRgbLink'
type CoverageMode = 'none' | 'mark' | 'test' | 'pointCore' | 'pointFringe'
type PreviousStyles = {
  points?: Buffer; links?: Buffer;
  pointCount: number; linkCount: number;
  pointSizes: SizeValues; linkWidths: SizeValues;
  animatePointSizes: boolean; animateLinkWidths: boolean;
}

type StyleUpdate = {
  animate?: boolean;
  previousProgress?: number;
  animatePointSizes?: boolean;
  animateLinkWidths?: boolean;
  continueTransition?: boolean;
  linkWidthsOnly?: boolean;
  linkTopologyOnly?: boolean;
  pointChannels?: PointChannels;
}
type EncodeOptions = {
  draw?: GraphDrawOptions;
  uniforms?: Buffer;
  linkPickPixel?: [number, number];
  fragmentOffset?: readonly [number, number];
  coverLinks?: boolean;
  candidates?: PointerCandidates;
  position?: PositionSource;
  coverPoints?: boolean;
}
const layout: ShaderLayout = {
  attributes: [],
  bindings: [
    { name: 'params', type: 'uniform', group: 0, location: 0 },
    { name: 'positions', type: 'read-only-storage', group: 0, location: 1 },
    { name: 'points', type: 'read-only-storage', group: 0, location: 2 },
    { name: 'links', type: 'read-only-storage', group: 0, location: 3 },
    { name: 'pointOrder', type: 'read-only-storage', group: 0, location: 4 },
    { name: 'atlas', type: 'texture', sampleType: 'float', viewDimension: '2d', group: 0, location: 5 },
    { name: 'atlasSampler', type: 'sampler', samplerType: 'filtering', group: 0, location: 6 },
    { name: 'previousPoints', type: 'read-only-storage', group: 0, location: 7 },
    { name: 'previousLinks', type: 'read-only-storage', group: 0, location: 8 },
    { name: 'previousPositions', type: 'read-only-storage', group: 0, location: 9 },
  ],
}

const compactLayout: ShaderLayout = {
  ...layout,
  bindings: [...layout.bindings!, { name: 'pickOrder', type: 'read-only-storage', group: 0, location: 10 }],
}

const pointReads = readPointStyle('readCurrentPoint', 'points') + readPointStyle('readPreviousPoint', 'previousPoints')
const pointShader = [records, common, pointReads, shapes, applePointCoordinates, points].join('\n')
const pointRingShader = [records, common, pointReads, pointRings].join('\n')
const linkShader = [records, common, pointReads, links].join('\n')
const pointerShader = [`const pickWindowSize = ${PICKING_WINDOW_SIZE}.0;`, records, common, pointReads, pickWindow].join('\n')
const noColor: Rgba = [0, 0, 0, -1]
const transparent: Rgba = [0, 0, 0, 0]
const pickBytesPerRow = 256 // WebGPU aligns rows in a texture-to-buffer copy.

/** The first nine rows encode the point window. The last row holds the link directly under the pointer. */
function readPointerPick (bytes: Uint8Array, window: PickingWindow): GraphPick | null {
  const unpackIndex = (offset: number): number => (bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16) - 1
  const pixels = new Float32Array(PICKING_WINDOW_SIZE ** 2 * 4)
  for (let y = 0; y < PICKING_WINDOW_SIZE; y++) {
    // The shared nearest-sample rule scans bottom-up; texture copies read top-down.
    const row = (PICKING_WINDOW_SIZE - 1 - y) * pickBytesPerRow
    for (let x = 0; x < PICKING_WINDOW_SIZE; x++) {
      pixels[4 * (y * PICKING_WINDOW_SIZE + x)] = unpackIndex(row + 4 * x)
    }
  }
  const point = resolveNearestPickedPoint(pixels, window.centerX - window.x, window.centerY - window.y)
  if (point) return { kind: 'point', index: point.index }
  const linkIndex = unpackIndex(PICKING_WINDOW_SIZE * pickBytesPerRow)
  return linkIndex < 0 ? null : { kind: 'link', index: linkIndex }
}

export class GraphRenderer {
  private uniforms!: Buffer
  private vertices!: VertexArray
  private pickTexture!: Texture
  private pickFramebuffer!: Framebuffer
  private readonly points: Points
  private readonly linkSource: string
  private readonly pointSource: string
  private pointerCandidates?: PointerCandidates
  private pointBuffer?: Buffer
  private readonly styleIds = new WeakMap<Buffer, Uint32Array>()
  private readonly lines: Lines
  private orderBuffer?: Buffer
  private readonly highlightPass: PointHighlightPass
  private highlightMask?: PointHighlightMask
  private order?: Uint32Array
  private baseOrder?: Uint32Array
  private pointSizes: SizeValues = 0
  private opaquePointArea = 0
  private previous?: PreviousStyles
  private interpolation: StyleTransition
  private pointCount = 0
  private revision = 0
  private isDisposed = false
  private transparentBackground: Rgba = transparent
  private greyExitColor: Rgba = transparent
  private hoverColor: Rgba = noColor
  private hoverRing: Rgba = transparent
  private focusRing: Rgba = transparent
  private kernels = new Map<string, RenderKernel>()
  private hostEncoder?: CommandEncoder
  private hostUniforms: Buffer[] = []
  private nextHostUniform = 0

  public constructor (
    private device: Device,
    private data: GraphData,
    private config: GraphConfigInterface,
    private positionSource: () => PositionSource | undefined,
    private readonly options: { ownsCanvas?: boolean; trackSizes?: boolean } = {}
  ) {
    this.points = new Points(device)
    this.lines = new Lines(device, !!options.trackSizes)
    this.highlightPass = new PointHighlightPass(device)
    // Native WebGL point sprites use different subpixel rules on these adapters.
    // Specialize the WGSL once for this device, including host draws and picking.
    this.pointSource = [
      `const applePointRaster = ${device.info.gpu === 'apple'};`,
      `const swiftShaderPointRaster = ${device.info.gpuArchitecture === 'swiftshader'};`,
      pointShader,
    ].join('\n')
    this.linkSource = `const swiftShaderQuad = ${device.info.gpuArchitecture === 'swiftshader'};\n${linkShader}`
    this.interpolation = new StyleTransition(device)
    try {
      this.uniforms = device.createBuffer({ id: 'cosmos-view', byteLength: 22 * 16, usage: Buffer.UNIFORM | Buffer.COPY_DST })
      this.vertices = device.createVertexArray({ shaderLayout: layout, bufferLayout: [] })
      this.pickTexture = device.createTexture({
        id: 'cosmos-pick', width: PICKING_WINDOW_SIZE, height: PICKING_WINDOW_SIZE + 1, format: 'rgba8unorm', usage: Texture.RENDER | Texture.COPY_SRC,
      })
      this.pickFramebuffer = device.createFramebuffer({
        colorAttachments: [this.pickTexture], width: this.pickTexture.width, height: this.pickTexture.height,
      })
    } catch (e) {
      this.destroy()
      throw e
    }
  }

  /** Over the dense limit, validate the resolved table before the simulation publishes data or uploads GPU state. */
  public withStyleCapacityCheck (
    count: number, interrupted: boolean, apply: (prepare?: (pointsOnly: boolean) => ReturnType<Points['pack']>) => void
  ): void {
    const limit = this.device.limits.maxStorageBufferBindingSize
    if (interrupted && this.previous?.points && this.pointBuffer && this.pointCount * pointStride * 4 > limit) {
      // The displayed source of the next animation can have more exceptions than either endpoint.
      interruptedPointTable(this.styleIds.get(this.previous.points), this.styleIds.get(this.pointBuffer), this.previous.pointCount, this.pointCount, limit)
    }
    if (count * pointStride * 4 <= limit || hasOnlyDefaultPointStyles(this.data, this.config)) {
      apply()
      return
    }
    this.points.withAtlas(this.data.inputImageData, () => apply(pointsOnly => this.packPointStyles(pointsOnly)))
  }

  /** Upload changed channels after the data model has resolved the pending setters. */
  public update (options: StyleUpdate = {}, prepared?: ReturnType<Points['pack']>): void {
    this.revision++
    const sameCounts = this.lines.count === (this.data.linksNumber ?? 0) && this.pointCount === (this.data.pointsNumber ?? 0)
    const widthsOnly = !!options.linkWidthsOnly && !!this.lines.buffer && sameCounts
    const pointChannels = this.pointCount && this.pointBuffer && this.highlightMask && sameCounts ? options.pointChannels : undefined
    const previous = this.capturePrevious(options, widthsOnly, !!pointChannels)
    try {
      if (pointChannels && (prepared || this.styleIds.has(this.pointBuffer!) || hasOnlyDefaultPointStyles(this.data, this.config))) {
        this.updateAllStyles(previous, true, prepared)
      } else if (pointChannels) {
        const sizes = pointChannels.sizes && this.options.trackSizes ? captureSizes(this.pointCount, i => this.data.getResolvedPointSize(i)) : this.pointSizes
        const source = this.points.updateStyles(this.pointBuffer!, this.data, this.config, pointChannels, previous?.points === this.pointBuffer)
        if (source && previous) previous.points = source
        this.pointSizes = sizes
        this.opaquePointArea = estimateOpaqueArea(this.data)
      } else if (options.linkTopologyOnly && this.pointBuffer && this.pointCount === this.data.pointsNumber) {
        this.lines.update(this.data, this.config, false)
      } else if (widthsOnly) {
        const snapshot = this.lines.updateWidths(this.data, !!previous && previous.links === this.lines.buffer)
        if (snapshot && previous) previous.links = snapshot
      } else {
        this.updateAllStyles(previous, false, prepared)
      }
    } catch (error) {
      if (previous?.points !== this.pointBuffer) previous?.points?.destroy()
      if (previous?.links !== this.lines.buffer) previous?.links?.destroy()
      throw error
    }
    if (previous || !options.continueTransition) {
      this.releasePrevious()
      this.previous = previous
    }
  }

  public getPointSize (index: number, progress: number): number {
    const source = this.previous?.animatePointSizes ? this.previous.pointSizes : undefined
    return displayedSize(index, progress, this.pointSizes, source, this.previous?.pointCount)
  }

  public getLinkWidth (index: number, progress: number): number {
    const source = this.previous?.animateLinkWidths ? this.previous.linkWidths : undefined
    return displayedSize(index, progress, this.lines.widths, source, this.previous?.linkCount)
  }

  public updatePointHighlights (): void {
    this.revision++
    if (!this.pointBuffer || !this.orderBuffer || !this.highlightMask || !this.order) return
    const mask = new PointHighlightMask(this.pointCount, this.config.highlightedPointIndices)
    const changes = mask.changesFrom(this.highlightMask)
    if (!changes.length) return
    if (this.styleIds.has(this.pointBuffer)) {
      const first = changes[0]!
      const end = changes[changes.length - 3]! + 1
      this.orderBuffer.write(mask.words.subarray(first, end), (this.pointCount + first) * 4)
    } else {
      const normal = this.config.pointOpacity
      this.highlightPass.apply(this.pointBuffer, changes, normal, this.config.pointGreyoutOpacity ?? normal)
    }
    if (mask.splitsOrder || this.highlightMask.splitsOrder) {
      const order = mask.drawOrder(this.baseOrder)
      let first = 0
      while (first < order.length && order[first] === this.order[first]) first++
      if (first < order.length) {
        let end = order.length
        while (order[end - 1] === this.order[end - 1]) end--
        this.orderBuffer.write(order.subarray(first, end), first * Uint32Array.BYTES_PER_ELEMENT)
        this.order = order
      }
    }
    this.highlightMask = mask
  }

  /** Record into a pass opened on the supplied device. The host owns clearing, ending and submitting. */
  public drawToRenderPass (pass: RenderPass, view: GraphView, options: GraphDrawOptions = {}): void {
    if (this.isDisposed || !this.pointCount) return
    if (pass.device !== this.device) throw new Error('The render pass and Graph must use the same WebGPU device')
    const framebuffer = pass.props.framebuffer ?? this.device.canvasContext?.getCurrentFramebuffer()
    if (!framebuffer) throw new Error('The host pass requires a framebuffer or a canvas context')

    // Each draw before the host submits needs its own uniform snapshot. Queue writes to the
    // same buffer would otherwise overwrite the first camera or pick ID with the second.
    const encoder = this.device.commandEncoder
    if (this.hostEncoder !== encoder) {
      this.hostEncoder = encoder
      this.nextHostUniform = 0
    }
    const index = this.nextHostUniform++
    const uniforms = this.hostUniforms[index] ??= this.device.createBuffer({
      id: 'cosmos-host-view', byteLength: this.uniforms.byteLength, usage: Buffer.UNIFORM | Buffer.COPY_DST,
    })
    const viewport = pass.getParameters().viewport
    this.encode(pass, framebuffer, view, [0, 0, view.width * view.pixelRatio, view.height * view.pixelRatio], {
      uniforms, draw: options, fragmentOffset: viewport && [-viewport[0], -viewport[1]],
    })
  }

  public draw (view: GraphView, target?: Framebuffer): void {
    const framebuffer = target ?? this.device.canvasContext?.getCurrentFramebuffer()
    if (!framebuffer || this.isDisposed) return
    // External framebuffers and open host passes retain their existing depth.
    // On the owned canvas, dense solid links get first use of opaque coverage.
    const ownsDepth = !!this.options.ownsCanvas && !target && this.config.pointOcclusionCulling && this.config.pointOpacity === 1 &&
      !!framebuffer.depthStencilAttachment && framebuffer.colorAttachments[0]!.texture.samples === 1
    const pixels = framebuffer.width * framebuffer.height
    const coverLinks = ownsDepth && this.config.renderLinks && this.lines.count >= pixels && this.canUseSolidLinks(view)
    const zoom = this.config.scalePointsOnZoom ? view.scale : Math.min(5, Math.max(1, view.scale * 0.01))
    const diameterScale = this.config.pointSizeScale * zoom * view.pixelRatio
    // The 200k-point M3 sweep had a marginal gain at 28 sprite pixels per
    // canvas pixel and a repeatable gain at 47. Sparse clouds keep one draw.
    // At most 2^23 ranks fit distinctly with room for the clear depth.
    const coverPoints = ownsDepth && !coverLinks && this.config.highlightedPointIndices === undefined &&
      this.opaquePointArea * diameterScale ** 2 >= 40 * pixels &&
      this.pointCount <= 2 ** 23 && this.pointCount === this.positionSource()?.pointCount
    const pass = this.device.beginRenderPass({
      framebuffer, clearColor: this.transparentBackground, clearDepth: coverLinks || coverPoints ? 1 : false, clearStencil: false,
    })
    try {
      this.encode(pass, framebuffer, view, [0, 0, framebuffer.width, framebuffer.height], { coverLinks, coverPoints })
    } finally { pass.end() }
    this.device.submit()
    if ((view.styleProgress ?? 1) >= 1) this.releasePrevious()
  }

  public async pick (xCss: number, yCss: number, view: GraphView): Promise<GraphPick | null> {
    if (this.isDisposed || !this.pointCount || xCss < 0 || yCss < 0 || xCss >= view.width || yCss >= view.height) return null
    const revision = this.revision
    const { width, height } = getPickingBufferSize(view.width, view.height)
    const window = getPickingWindow(width, height, xCss, view.height - yCss, view.width, view.height)
    const framebuffer = this.pickFramebuffer
    // The WebGL link index is CSS-resolution and uses lower-left coordinates.
    // Integer mouse y lies on a texel boundary and selects the sample above it.
    const linkPixel: [number, number] = [Math.floor(xCss), Math.max(0, Math.ceil(yCss) - 1)]
    const region: [number, number, number, number] = [window.x, window.y, width, height]
    const position = this.positionSource()
    const candidates = this.findPointerCandidates(view, region, linkPixel, position)
    const pass = this.device.beginRenderPass({ framebuffer, clearColor: transparent, clearDepth: false, clearStencil: false })
    try { this.encode(pass, framebuffer, view, region, { linkPickPixel: linkPixel, candidates, position }) } finally { pass.end() }
    // Take one snapshot of both passes before another query can overwrite the target.
    const staging = this.device.createBuffer({
      id: 'cosmos-pick-read', byteLength: pickBytesPerRow * framebuffer.height, usage: Buffer.COPY_DST | Buffer.COPY_SRC,
    })
    try {
      this.device.commandEncoder.copyTextureToBuffer({
        sourceTexture: this.pickTexture, destinationBuffer: staging, width: framebuffer.width, height: framebuffer.height, bytesPerRow: pickBytesPerRow,
      })
      this.device.submit()
      const bytes = await staging.readAsync()
      if (this.isDisposed || revision !== this.revision) return null
      return readPointerPick(bytes, window)
    } finally { staging.destroy() }
  }

  public destroy (): void {
    if (this.isDisposed) return
    this.isDisposed = true
    this.kernels.forEach(kernel => kernel.destroy())
    this.kernels.clear()
    this.pointerCandidates?.destroy()
    this.interpolation.destroy()
    this.releasePrevious()
    this.pickFramebuffer?.destroy()
    this.pickTexture?.destroy()
    this.points.destroy()
    this.highlightPass.destroy()
    this.highlightMask = undefined
    this.order = this.baseOrder = undefined
    this.pointBuffer?.destroy()
    this.lines.destroy()
    this.orderBuffer?.destroy()
    this.pointSizes = 0
    this.hostUniforms.forEach(buffer => buffer.destroy())
    this.hostUniforms.length = 0
    this.hostEncoder = undefined
    this.uniforms?.destroy()
    this.vertices?.destroy()
  }

  private findPointerCandidates (view: GraphView, region: [number, number, number, number], pixel: [number, number],
    position?: PositionSource): PointerCandidates | undefined {
    const c = this.config
    const projection = view.pointProjection
    const points = Math.min(this.pointCount, position?.pointCount ?? 0)
    const links = c.renderLinks ? this.lines.count : 0
    const count = Math.max(points, links)
    // Transition bounds and curved ribbons stay with the ordinary raster pass.
    if (count < 65536 || count > 0xffffff || (links > 0 && (c.curvedLinks || !c.linkBlending)) || this.previous || view.previousPositions ||
        !projection || !position || !this.pointBuffer || !this.orderBuffer || !this.lines.buffer ||
        Math.ceil(count / 128) > this.device.limits.maxComputeWorkgroupsPerDimension) return undefined
    this.pointerCandidates ??= new PointerCandidates(this.device)
    this.pointerCandidates.select(c, view, projection, region, pixel, points, links,
      position.buffer, this.pointBuffer, this.orderBuffer, this.lines.buffer, this.recordCount(this.pointBuffer))
    return this.pointerCandidates
  }

  private recordCount (buffer: Buffer): number {
    const ids = this.styleIds.get(buffer)
    return ids ? ids.length + 1 : 0
  }

  private packPointStyles (pointsOnly: boolean): ReturnType<Points['pack']> {
    const background = getRgbaColor(this.config.backgroundColor)
    const clearColor = background[3] > 0 ? background : transparent
    const wasCompact = !!this.pointBuffer && this.styleIds.has(this.pointBuffer)
    const ordering = pointsOnly && this.highlightMask && this.order ? { mask: this.highlightMask, order: this.order } : undefined
    return this.points.pack(this.data, this.config, clearColor, wasCompact, ordering)
  }

  private updateAllStyles (previous: PreviousStyles | undefined, pointsOnly: boolean, prepared?: ReturnType<Points['pack']>): void {
    this.points.withAtlas(this.data.inputImageData, () => this.uploadStyles(previous, pointsOnly, prepared ?? this.packPointStyles(pointsOnly)))
  }

  private uploadStyles (previous: PreviousStyles | undefined, pointsOnly: boolean, styles: ReturnType<Points['pack']>): void {
    const data = this.data
    const config = this.config
    const pointCount = data.pointsNumber ?? 0
    const background = getRgbaColor(config.backgroundColor)
    const clearColor = background[3] > 0 ? background : transparent
    const wasCompact = !!this.pointBuffer && this.styleIds.has(this.pointBuffer)
    const { attributes, ids, order, mask, greyExitColor } = styles
    const pointSizes = this.options.trackSizes ? captureSizes(pointCount, i => data.getResolvedPointSize(i)) : 0
    const oldPointTarget = previous?.points === this.pointBuffer ? undefined : this.pointBuffer
    let pointBuffer: Buffer | undefined
    let orderBuffer: Buffer | undefined
    try {
      if (pointsOnly && this.order === order && wasCompact === !!ids) orderBuffer = this.orderBuffer!
      else {
        let orderAndMask = order
        if (ids) {
          orderAndMask = new Uint32Array(order.length + mask.words.length)
          orderAndMask.set(order)
          orderAndMask.set(mask.words, order.length)
        }
        orderBuffer = updateStyleBuffer(this.device, this.orderBuffer, orderAndMask, 'cosmos-point-order', 4)
      }
      const reusable = ids && oldPointTarget?.byteLength !== attributes.byteLength ? undefined : oldPointTarget
      pointBuffer = updateStyleBuffer(this.device, reusable, attributes, 'cosmos-point-style', pointStride * 4)
      if (!pointsOnly) this.lines.update(data, config, !!previous && previous.links === this.lines.buffer)
    } catch (error) {
      if (pointBuffer !== this.pointBuffer) pointBuffer?.destroy()
      if (orderBuffer !== this.orderBuffer) orderBuffer?.destroy()
      throw error
    }
    if (oldPointTarget !== pointBuffer) oldPointTarget?.destroy()
    if (this.orderBuffer !== orderBuffer) this.orderBuffer?.destroy()
    if (ids) this.styleIds.set(pointBuffer, ids)
    else this.styleIds.delete(pointBuffer)
    this.pointBuffer = pointBuffer
    this.orderBuffer = orderBuffer
    this.pointSizes = pointSizes
    this.pointCount = pointCount
    this.opaquePointArea = estimateOpaqueArea(data)
    const [r, g, b, a] = clearColor
    this.transparentBackground = [r * a, g * a, b * a, a]
    this.greyExitColor = greyExitColor
    this.hoverColor = config.hoveredLinkColor ? getRgbaColor(config.hoveredLinkColor) : noColor
    // The reference stores the configured RGB with a fixed interface opacity.
    const [hr, hg, hb] = getRgbaColor(config.hoveredPointRingColor)
    const [fr, fg, fb] = getRgbaColor(config.focusedPointRingColor)
    this.hoverRing = [hr, hg, hb, hoveredPointRingOpacity]
    this.focusRing = [fr, fg, fb, focusedPointRingOpacity]
    this.highlightMask = mask
    this.order = order
    this.baseOrder = data.pointRenderOrder
  }

  /** Retain or freeze the displayed styles once, before an interrupting update changes their targets. */
  private capturePrevious (options: StyleUpdate, widthsOnly: boolean, pointsOnly: boolean): PreviousStyles | undefined {
    if (!options.animate || !this.pointCount || !this.pointBuffer || !this.lines.buffer) return undefined
    let points = widthsOnly ? undefined : this.pointBuffer
    let links = pointsOnly ? undefined : this.lines.buffer
    let pointSizes = this.pointSizes
    let linkWidths = this.lines.widths
    const animatePointSizes = options.animatePointSizes ?? true
    const animateLinkWidths = options.animateLinkWidths ?? true
    const progress = Math.max(0, Math.min(1, options.previousProgress ?? 1))
    const previous = this.previous
    if (previous && progress < 1) {
      if (this.options.trackSizes && animatePointSizes && previous.animatePointSizes) {
        pointSizes = captureSizes(this.pointCount, i => this.getPointSize(i, progress))
      }
      if (this.options.trackSizes && animateLinkWidths && previous.animateLinkWidths) {
        linkWidths = captureSizes(this.lines.count, i => this.getLinkWidth(i, progress))
      }
      if (previous.points) {
        points = this.interpolation.freezePoints(
          previous.points, this.pointBuffer, progress, previous.pointCount, this.pointCount, previous.animatePointSizes, this.styleIds
        )
      }
      try {
        if (previous.links) {
          links = this.interpolation.freeze(
            'Link', previous.links, this.lines.buffer, progress, previous.linkCount, this.lines.count, previous.animateLinkWidths
          )
        }
      } catch (error) {
        if (points !== this.pointBuffer) points?.destroy()
        throw error
      }
    }
    return { points, links, pointCount: this.pointCount, linkCount: this.lines.count, pointSizes, linkWidths, animatePointSizes, animateLinkWidths }
  }

  private releasePrevious (): void {
    this.previous?.points?.destroy()
    this.previous?.links?.destroy()
    this.previous = undefined
  }

  private canUseSolidLinks (view: GraphView): boolean {
    return this.lines.hasOnlySolidLinks && this.config.linkBlending && !this.config.linkColorInterpolateFromEndpoints &&
      view.hoveredLink === undefined && (!this.previous || (view.styleProgress ?? 1) >= 1)
  }

  private kernel (framebuffer: Framebuffer, kind: DrawKind, picking: boolean, coverage: CoverageMode = 'none', compact = false): RenderKernel {
    const color = framebuffer.colorAttachments[0]!.texture.format as TextureFormatColor
    const depth = framebuffer.depthStencilAttachment?.texture.format as TextureFormatDepthStencil | undefined
    const samples = framebuffer.colorAttachments[0]!.texture.samples
    const key = [kind, color, depth, samples, picking, coverage, compact].join('/')
    let kernel = this.kernels.get(key)
    if (!kernel) {
      const source = kind === 'point' ? this.pointSource : kind === 'pointerPoint' ? pointerShader : kind === 'pointRing' ? pointRingShader : this.linkSource
      const ranked = coverage === 'pointCore' || coverage === 'pointFringe'
      const vertexKind = ranked ? coverage : kind === 'uniformRgbLink' ? 'solidLink' : kind
      const fragmentKind = coverage === 'pointCore' ? coverage : coverage === 'mark' ? 'opaquePoint' : kind
      const depthWriteEnabled = coverage === 'mark' || coverage === 'pointCore'
      const depthCompare = coverage === 'test' || ranked ? 'less' : 'always'
      kernel = new RenderKernel(this.device, {
        id: `cosmos-${key}`,
        vertexSource: source,
        fragmentSource: source,
        vertexEntryPoint: compact ? (kind === 'pointerPoint' ? 'compactPointVertex' : 'compactLinkVertex') : `${vertexKind}Vertex`,
        fragmentEntryPoint: `${fragmentKind}Fragment`,
        topology: 'triangle-strip',
        shaderLayout: compact ? compactLayout : layout,
        colorAttachmentFormats: [color],
        depthStencilAttachmentFormat: depth,
        parameters: {
          ...(depth ? { depthWriteEnabled, depthCompare } : {}),
          colorMask: coverage === 'mark' ? 0 : 0xf,
          sampleCount: samples,
          cullMode: 'none',
          blend: !picking && !depthWriteEnabled,
          blendColorOperation: 'add',
          blendColorSrcFactor: 'src-alpha',
          blendColorDstFactor: 'one-minus-src-alpha',
          blendAlphaOperation: 'add',
          blendAlphaSrcFactor: 'one',
          blendAlphaDstFactor: 'one-minus-src-alpha',
        },
      })
      this.kernels.set(key, kernel)
    }
    return kernel
  }

  private encode (
    pass: RenderPass, framebuffer: Framebuffer, view: GraphView, region: [number, number, number, number],
    {
      uniforms = this.uniforms, draw: options = {}, linkPickPixel, fragmentOffset, coverLinks = false, coverPoints = false,
      candidates, position = this.positionSource(),
    }: EncodeOptions
  ): void {
    if (!position || !this.pointCount || !this.pointBuffer || !this.orderBuffer || !this.lines.buffer || !this.points.atlas) return
    const picking = !!options.picking || !!linkPickPixel
    const c = this.config
    const segments = c.curvedLinks ? Math.max(1, Math.round(c.curvedLinkSegments)) : 1
    const params = new Float32Array([
      view.x, view.y, view.scale, view.pixelRatio, ...region,
      c.pointSizeScale, +c.scalePointsOnZoom, options.picking?.alpha ?? 1, options.picking?.linkIndexOffset ?? 0,
      c.linkWidthScale, +c.scaleLinksOnZoom, c.linkOpacity, +c.linkBlending,
      segments, c.curvedLinkWeight, c.curvedLinkControlPointDistance, 5,
      ...c.linkVisibilityDistanceRange, c.linkVisibilityMinTransparency, +c.linkColorInterpolateFromEndpoints,
      view.hoveredPoint ?? -1, c.focusedPointIndex ?? -1, view.hoveredLink ?? -1, c.focusedLinkIndex ?? -1,
      c.hoveredLinkWidthIncrease, c.focusedLinkWidthIncrease, c.linkDashLength, c.linkDashGap,
      linkPickPixel ? 2 : +picking, c.linkArrowsSizeScale, position.pointCount, options.picking?.alpha ?? 0.5,
      ...this.hoverColor, ...this.hoverRing, ...this.focusRing,
      this.previous ? Math.max(0, Math.min(1, view.styleProgress ?? 1)) : 1, this.previous?.points ? this.previous.pointCount : 0,
      this.previous?.links ? this.previous.linkCount : 0, 64,
      shadeDirection(c.pointDefaultStrokeColor), c.pointStrokeContrast, shadeDirection(c.outlinedPointRingColor), c.outlinedPointRingContrast,
      view.pointProjection?.origin[0] ?? 0, view.pointProjection?.origin[1] ?? 0, view.width, view.height,
      ...(view.pointProjection?.transform ?? [view.scale, view.scale, 2 * view.x / view.width - 1, 1 - 2 * view.y / view.height]),
      ...(linkPickPixel ?? [0, 0]), Number(this.previous?.animatePointSizes ?? false), Number(this.previous?.animateLinkWidths ?? false),
      ...(this.lines.uniformRgb ?? [0, 0, 0]), view.previousPositions ? view.styleProgress ?? 1 : 1,
      ...this.greyExitColor,
      c.pointOpacity, c.pointGreyoutOpacity ?? -1, c.pointGreyoutColor ? 1 : 0, view.hostHoveredPoint ?? -1,
      fragmentOffset?.[0] ?? region[0], fragmentOffset?.[1] ?? region[1],
      0, 0, 0, 0, 0, 0,
    ])
    new Uint32Array(params.buffer).set([this.recordCount(this.pointBuffer), this.recordCount(this.previous?.points ?? this.pointBuffer), this.pointCount], 82)
    uniforms.write(params)
    const bindings = {
      params: uniforms,
      positions: position.buffer,
      points: this.pointBuffer,
      links: this.lines.buffer,
      pointOrder: this.orderBuffer,
      atlas: this.points.atlas,
      previousPoints: this.previous?.points ?? this.pointBuffer,
      previousLinks: this.previous?.links ?? this.lines.buffer,
      previousPositions: view.previousPositions ?? position.buffer,
    }
    const pointCount = Math.min(position.pointCount, this.pointCount)
    if (options.links !== false && c.renderLinks && this.lines.count) {
      if (linkPickPixel) pass.setParameters({ viewport: [0, PICKING_WINDOW_SIZE, 1, 1] })
      if (coverLinks) {
        this.kernel(framebuffer, 'point', false, 'mark').draw(pass, {
          vertexArray: this.vertices, vertexCount: 4, instanceCount: pointCount, bindings,
        })
      }
      const useSolid = !picking && this.canUseSolidLinks(view)
      const kind = useSolid ? (this.lines.uniformRgb ? 'uniformRgbLink' : 'solidLink') : 'link'
      const kernel = this.kernel(framebuffer, kind, picking, coverLinks ? 'test' : 'none', !!candidates)
      if (candidates) {
        kernel.drawIndirect(pass, {
          vertexArray: this.vertices, indirectBuffer: candidates.draws, bindings: { ...bindings, pickOrder: candidates.links },
        })
      } else {
        kernel.draw(pass, {
          vertexArray: this.vertices, vertexCount: 2 * (segments + 1), instanceCount: this.lines.count, bindings,
        })
      }
    }
    if (options.points === false) return
    if (linkPickPixel) pass.setParameters({ viewport: [0, 0, PICKING_WINDOW_SIZE, PICKING_WINDOW_SIZE] })
    if (coverPoints) {
      this.kernel(framebuffer, 'point', false, 'pointCore').draw(pass, {
        vertexArray: this.vertices, vertexCount: 4, instanceCount: pointCount, bindings,
      })
    }
    const kernel = this.kernel(framebuffer, linkPickPixel ? 'pointerPoint' : 'point', picking, coverPoints ? 'pointFringe' : 'none', !!candidates)
    if (candidates) {
      kernel.drawIndirect(pass, {
        vertexArray: this.vertices, indirectBuffer: candidates.draws, indirectOffset: 16, bindings: { ...bindings, pickOrder: candidates.points },
      })
    } else {
      kernel.draw(pass, {
        vertexArray: this.vertices, vertexCount: 4, instanceCount: pointCount, bindings,
      })
    }
    if (!picking && (view.hoveredPoint !== undefined || view.hostHoveredPoint !== undefined || c.focusedPointIndex !== undefined)) {
      this.kernel(framebuffer, 'pointRing', false).draw(pass, {
        vertexArray: this.vertices, vertexCount: 4, instanceCount: 3, bindings,
      })
    }
  }
}
