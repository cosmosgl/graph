import {
  Buffer, Texture, type CommandEncoder, type Device, type Framebuffer, type RenderPass, type ShaderLayout,
  type TextureFormatColor, type TextureFormatDepthStencil, type VertexArray,
} from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '../../../src/config'
import { getRgbaColor } from '../../../src/helper'
import type { GraphData } from '../../../src/modules/GraphData'
import { packLinks, linkStride, type LinkRgb } from './modules/Lines'
import { Points, pointStride, shadeDirection } from './modules/Points'
import { PointHighlightPass, PointHighlightMask } from './modules/Points/highlights'
import { StyleTransition } from './style-transition'
import { captureSizes, displayedSize, type SizeValues } from './size-transition'
import records from './style-records.wgsl?raw'
import common from './draw-common.wgsl?raw'
import applePointCoordinates from './modules/Points/apple-point-coordinates.wgsl?raw'
import shapes from './modules/Points/point-shapes.wgsl?raw'
import points from './modules/Points/draw-points.wgsl?raw'
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
  hoveredLink?: number;
  /** Eased interpolation factor supplied by the Graph animation clock. */
  styleProgress?: number;
  /** Point and link width cap in CSS pixels, shared with screen-space queries. */
  maxPointSize?: number;
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
type DrawKind = 'point' | 'link' | 'solidLink' | 'uniformRgbLink'
type CoverageMode = 'none' | 'mark' | 'test'
type StyleUpdate = {
  animate?: boolean;
  previousProgress?: number;
  animatePointSizes?: boolean;
  animateLinkWidths?: boolean;
  continueTransition?: boolean;
}
type EncodeOptions = {
  draw?: GraphDrawOptions;
  uniforms?: Buffer;
  linkPickPixel?: [number, number];
  coverLinks?: boolean;
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
  ],
}

const pointShader = [records, common, shapes, applePointCoordinates, points].join('\n')
const linkShader = [records, common, links].join('\n')
const noColor: Rgba = [0, 0, 0, -1]
const transparent: Rgba = [0, 0, 0, 0]

export class GraphRenderer {
  private uniforms!: Buffer
  private vertices!: VertexArray
  private pickTexture!: Texture
  private pickFramebuffer!: Framebuffer
  private readonly points: Points
  private readonly linkSource: string
  private readonly pointSource: string
  private pointBuffer?: Buffer
  private linkBuffer?: Buffer
  private orderBuffer?: Buffer
  private readonly highlightPass: PointHighlightPass
  private highlightMask?: PointHighlightMask
  private order?: Uint32Array
  private baseOrder?: Uint32Array
  private pointSizes: SizeValues = 0
  private linkWidths: SizeValues = 0
  private previous?: {
    points: Buffer; links: Buffer;
    pointCount: number; linkCount: number;
    pointSizes: SizeValues; linkWidths: SizeValues;
    animatePointSizes: boolean; animateLinkWidths: boolean;
  }

  private interpolation: StyleTransition
  private pointCount = 0
  private linkCount = 0
  private hasOnlySolidLinks = false
  private uniformLinkRgb?: LinkRgb
  private revision = 0
  private isDisposed = false
  private transparentBackground: Rgba = transparent
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
      this.uniforms = device.createBuffer({ id: 'cosmos-view', byteLength: 18 * 16, usage: Buffer.UNIFORM | Buffer.COPY_DST })
      this.vertices = device.createVertexArray({ shaderLayout: layout, bufferLayout: [] })
      this.pickTexture = device.createTexture({ id: 'cosmos-pick', width: 1, height: 1, format: 'rgba8unorm', usage: Texture.RENDER | Texture.COPY_SRC })
      this.pickFramebuffer = device.createFramebuffer({ colorAttachments: [this.pickTexture] })
    } catch (e) {
      this.destroy()
      throw e
    }
  }

  /** Upload changed channels after the data model has resolved the pending setters. */
  public update (options: StyleUpdate = {}): void {
    const data = this.data
    const config = this.config
    this.revision++
    this.points.updateAtlas(data.inputImageData)
    const pointCount = data.pointsNumber ?? 0
    const linkCount = data.linksNumber ?? 0
    const background = getRgbaColor(config.backgroundColor)
    const clearColor = background[3] > 0 ? background : transparent
    const [r, g, b, a] = clearColor
    this.transparentBackground = [r * a, g * a, b * a, a]
    this.hoverColor = config.hoveredLinkColor ? getRgbaColor(config.hoveredLinkColor) : noColor
    this.hoverRing = getRgbaColor(config.hoveredPointRingColor)
    this.focusRing = getRgbaColor(config.focusedPointRingColor)

    const { attributes, order, mask, colors } = this.points.pack(data, config, clearColor)
    const { edges, hasOnlySolidLinks, uniformRgb } = packLinks(data, config)
    const progress = Math.max(0, Math.min(1, options.previousProgress ?? 1))
    const animate = options.animate && this.pointCount > 0
    if (animate && this.pointBuffer && this.linkBuffer) {
      // Keep the last target on the GPU. When interrupted, bake the actual displayed styles so
      // the next interpolation starts at the current appearance rather than the previous target.
      let fromPoints = this.pointBuffer
      let fromLinks = this.linkBuffer
      let pointSizes = this.pointSizes
      let linkWidths = this.linkWidths
      const animatePointSizes = options.animatePointSizes ?? true
      const animateLinkWidths = options.animateLinkWidths ?? true
      if (this.previous && progress < 1) {
        const previous = this.previous
        if (this.options.trackSizes && animatePointSizes && previous.animatePointSizes) {
          pointSizes = captureSizes(this.pointCount, index => this.getPointSize(index, progress))
        }
        if (this.options.trackSizes && animateLinkWidths && previous.animateLinkWidths) {
          linkWidths = captureSizes(this.linkCount, index => this.getLinkWidth(index, progress))
        }
        fromPoints = this.interpolation.freeze(
          'Point', previous.points, this.pointBuffer, progress, previous.pointCount, this.pointCount, previous.animatePointSizes
        )
        try {
          fromLinks = this.interpolation.freeze(
            'Link', previous.links, this.linkBuffer, progress, previous.linkCount, this.linkCount, previous.animateLinkWidths
          )
        } catch (e) { fromPoints.destroy(); throw e }
      }
      this.releasePrevious()
      this.previous = {
        points: fromPoints,
        links: fromLinks,
        pointCount: this.pointCount,
        linkCount: this.linkCount,
        pointSizes,
        linkWidths,
        animatePointSizes,
        animateLinkWidths,
      }
      if (fromPoints === this.pointBuffer) this.pointBuffer = undefined
      if (fromLinks === this.linkBuffer) this.linkBuffer = undefined
    } else if (!options.continueTransition) {
      this.releasePrevious()
    }
    this.pointBuffer = this.storage(this.pointBuffer, attributes, 'cosmos-point-style', pointStride * 4)
    this.orderBuffer = this.storage(this.orderBuffer, order, 'cosmos-point-order', 4)
    this.linkBuffer = this.storage(this.linkBuffer, edges, 'cosmos-link-style', linkStride * 4)
    if (this.options.trackSizes) {
      this.pointSizes = captureSizes(pointCount, i => attributes[i * pointStride + 4]!)
      this.linkWidths = captureSizes(linkCount, i => edges[i * linkStride + 2]!)
    }
    this.pointCount = pointCount
    this.linkCount = linkCount
    this.hasOnlySolidLinks = hasOnlySolidLinks
    this.uniformLinkRgb = uniformRgb
    this.highlightPass.setColors(colors)
    this.highlightMask = mask
    this.order = order
    this.baseOrder = data.pointRenderOrder
  }

  public getPointSize (index: number, progress: number): number {
    const source = this.previous?.animatePointSizes ? this.previous.pointSizes : undefined
    return displayedSize(index, progress, this.pointSizes, source, this.previous?.pointCount)
  }

  public getLinkWidth (index: number, progress: number): number {
    const source = this.previous?.animateLinkWidths ? this.previous.linkWidths : undefined
    return displayedSize(index, progress, this.linkWidths, source, this.previous?.linkCount)
  }

  public updatePointHighlights (): void {
    this.revision++
    // A config update snaps to the target of an active style transition.
    this.releasePrevious()
    if (!this.pointBuffer || !this.orderBuffer || !this.highlightMask || !this.order) return
    const mask = new PointHighlightMask(this.pointCount, this.config.highlightedPointIndices)
    const changes = mask.changesFrom(this.highlightMask)
    if (!changes.length) return
    const normal = this.config.pointOpacity
    this.highlightPass.apply(this.pointBuffer, changes, normal, this.config.pointGreyoutOpacity ?? normal)
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
    this.encode(pass, framebuffer, view, [0, 0, view.width * view.pixelRatio, view.height * view.pixelRatio], { uniforms, draw: options })
  }

  public draw (view: GraphView, target?: Framebuffer): void {
    const framebuffer = target ?? this.device.canvasContext?.getCurrentFramebuffer()
    if (!framebuffer || this.isDisposed) return
    // On the owned canvas the existing depth attachment can reject link
    // fragments hidden by opaque points. Reserve the extra point draw for
    // dense graphs with at least one link per device pixel.
    const coverLinks = !!this.options.ownsCanvas && !target && this.config.pointOcclusionCulling && this.config.pointOpacity === 1 &&
      !!framebuffer.depthStencilAttachment && framebuffer.colorAttachments[0]!.texture.samples === 1 &&
      this.config.renderLinks && this.linkCount >= framebuffer.width * framebuffer.height && this.canUseSolidLinks(view)
    const pass = this.device.beginRenderPass({
      framebuffer, clearColor: this.transparentBackground, clearDepth: coverLinks ? 1 : false, clearStencil: false,
    })
    try {
      this.encode(pass, framebuffer, view, [0, 0, framebuffer.width, framebuffer.height], { coverLinks })
    } finally { pass.end() }
    this.device.submit()
    if ((view.styleProgress ?? 1) >= 1) this.releasePrevious()
  }

  public async pick (xCss: number, yCss: number, view: GraphView): Promise<GraphPick | null> {
    if (this.isDisposed || !this.pointCount || xCss < 0 || yCss < 0 || xCss >= view.width || yCss >= view.height) return null
    const revision = this.revision
    const x = Math.floor(xCss * view.pixelRatio)
    const y = Math.floor(yCss * view.pixelRatio)
    const framebuffer = this.pickFramebuffer
    const pass = this.device.beginRenderPass({ framebuffer, clearColor: transparent, clearDepth: false, clearStencil: false })
    // The WebGL link index is CSS-resolution and uses lower-left coordinates.
    // Integer mouse y lies on a texel boundary and selects the sample above it.
    const linkPixel: [number, number] = [Math.floor(xCss), Math.max(0, Math.ceil(yCss) - 1)]
    try { this.encode(pass, framebuffer, view, [x, y, 1, 1], { linkPickPixel: linkPixel }) } finally { pass.end() }
    // Each query takes its own snapshot before the next pick can overwrite the one-pixel target.
    const staging = this.device.createBuffer({ id: 'cosmos-pick-read', byteLength: 256, usage: Buffer.COPY_DST | Buffer.COPY_SRC })
    try {
      this.device.commandEncoder.copyTextureToBuffer({
        sourceTexture: this.pickTexture, destinationBuffer: staging, width: 1, height: 1, bytesPerRow: 256,
      })
      this.device.submit()
      const bytes = await staging.readAsync(0, 4)
      if (this.isDisposed || revision !== this.revision) return null
      const id = (bytes[0] ?? 0) + (bytes[1] ?? 0) * 256 + (bytes[2] ?? 0) * 65536
      return id ? { kind: bytes[3] === 255 ? 'point' : 'link', index: id - 1 } : null
    } finally { staging.destroy() }
  }

  public destroy (): void {
    if (this.isDisposed) return
    this.isDisposed = true
    this.kernels.forEach(kernel => kernel.destroy())
    this.kernels.clear()
    this.interpolation.destroy()
    this.releasePrevious()
    this.pickFramebuffer?.destroy()
    this.pickTexture?.destroy()
    this.points.destroy()
    this.highlightPass.destroy()
    this.highlightMask = undefined
    this.order = this.baseOrder = undefined
    this.pointBuffer?.destroy()
    this.linkBuffer?.destroy()
    this.orderBuffer?.destroy()
    this.pointSizes = this.linkWidths = 0
    this.hostUniforms.forEach(buffer => buffer.destroy())
    this.hostUniforms.length = 0
    this.hostEncoder = undefined
    this.uniforms?.destroy()
    this.vertices?.destroy()
  }

  private storage (old: Buffer | undefined, values: Float32Array | Uint32Array, id: string, minBytes: number): Buffer {
    const bytes = Math.max(minBytes, values.byteLength)
    if (bytes > this.device.limits.maxStorageBufferBindingSize) {
      throw new Error(`${id} requires ${bytes} bytes of storage (device limit ${this.device.limits.maxStorageBufferBindingSize})`)
    }
    if (old && old.byteLength >= bytes) {
      if (values.length) old.write(values)
      return old
    }
    const next = this.device.createBuffer({ id, byteLength: bytes, usage: Buffer.STORAGE | Buffer.COPY_DST })
    try {
      if (values.length) next.write(values)
    } catch (e) {
      next.destroy()
      throw e
    }
    old?.destroy()
    return next
  }

  private releasePrevious (): void {
    this.previous?.points.destroy()
    this.previous?.links.destroy()
    this.previous = undefined
  }

  private canUseSolidLinks (view: GraphView): boolean {
    return this.hasOnlySolidLinks && this.config.linkBlending && !this.config.linkColorInterpolateFromEndpoints &&
      view.hoveredLink === undefined && (!this.previous || (view.styleProgress ?? 1) >= 1)
  }

  private kernel (framebuffer: Framebuffer, kind: DrawKind, picking: boolean, coverage: CoverageMode = 'none'): RenderKernel {
    const color = framebuffer.colorAttachments[0]!.texture.format as TextureFormatColor
    const depth = framebuffer.depthStencilAttachment?.texture.format as TextureFormatDepthStencil | undefined
    const samples = framebuffer.colorAttachments[0]!.texture.samples
    const key = [kind, color, depth, samples, picking, coverage].join('/')
    let kernel = this.kernels.get(key)
    if (!kernel) {
      const source = kind === 'point' ? this.pointSource : this.linkSource
      kernel = new RenderKernel(this.device, {
        id: `cosmos-${key}`,
        vertexSource: source,
        fragmentSource: source,
        vertexEntryPoint: kind === 'uniformRgbLink' ? 'solidLinkVertex' : `${kind}Vertex`,
        fragmentEntryPoint: coverage === 'mark' ? 'opaquePointFragment' : `${kind}Fragment`,
        topology: 'triangle-strip',
        shaderLayout: layout,
        colorAttachmentFormats: [color],
        depthStencilAttachmentFormat: depth,
        parameters: {
          ...(depth ? { depthWriteEnabled: coverage === 'mark', depthCompare: coverage === 'test' ? 'less' as const : 'always' as const } : {}),
          colorMask: coverage === 'mark' ? 0 : 0xf,
          sampleCount: samples,
          cullMode: 'none',
          blend: !picking && coverage !== 'mark',
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
    { uniforms = this.uniforms, draw: options = {}, linkPickPixel, coverLinks = false }: EncodeOptions
  ): void {
    const position = this.positionSource()
    if (!position || !this.pointCount || !this.pointBuffer || !this.orderBuffer || !this.linkBuffer || !this.points.atlas) return
    const picking = !!options.picking || !!linkPickPixel
    const c = this.config
    const segments = c.curvedLinks ? Math.max(1, Math.round(c.curvedLinkSegments)) : 1
    uniforms.write(new Float32Array([
      view.x, view.y, view.scale, view.pixelRatio, ...region,
      c.pointSizeScale, +c.scalePointsOnZoom, options.picking?.alpha ?? 1, options.picking?.linkIndexOffset ?? 0,
      c.linkWidthScale, +c.scaleLinksOnZoom, c.linkOpacity, +c.linkBlending,
      segments, c.curvedLinkWeight, c.curvedLinkControlPointDistance, 5,
      ...c.linkVisibilityDistanceRange, c.linkVisibilityMinTransparency, +c.linkColorInterpolateFromEndpoints,
      view.hoveredPoint ?? -1, c.focusedPointIndex ?? -1, view.hoveredLink ?? -1, c.focusedLinkIndex ?? -1,
      c.hoveredLinkWidthIncrease, c.focusedLinkWidthIncrease, c.linkDashLength, c.linkDashGap,
      linkPickPixel ? 2 : +picking, c.linkArrowsSizeScale, position.pointCount, options.picking?.alpha ?? 0.5,
      ...this.hoverColor, ...this.hoverRing, ...this.focusRing,
      this.previous ? Math.max(0, Math.min(1, view.styleProgress ?? 1)) : 1, this.previous?.pointCount ?? 0,
      this.previous?.linkCount ?? 0, view.maxPointSize ?? 64,
      shadeDirection(c.pointDefaultStrokeColor), c.pointStrokeContrast, shadeDirection(c.outlinedPointRingColor), c.outlinedPointRingContrast,
      view.pointProjection?.origin[0] ?? 0, view.pointProjection?.origin[1] ?? 0, view.width, view.height,
      ...(view.pointProjection?.transform ?? [view.scale, view.scale, 2 * view.x / view.width - 1, 1 - 2 * view.y / view.height]),
      ...(linkPickPixel ?? [0, 0]), Number(this.previous?.animatePointSizes ?? false), Number(this.previous?.animateLinkWidths ?? false),
      ...(this.uniformLinkRgb ?? [0, 0, 0]), 0,
    ]))
    const bindings = {
      params: uniforms,
      positions: position.buffer,
      points: this.pointBuffer,
      links: this.linkBuffer,
      pointOrder: this.orderBuffer,
      atlas: this.points.atlas,
      previousPoints: this.previous?.points ?? this.pointBuffer,
      previousLinks: this.previous?.links ?? this.linkBuffer,
    }
    const pointCount = Math.min(position.pointCount, this.pointCount)
    if (options.links !== false && c.renderLinks && this.linkCount) {
      if (coverLinks) {
        this.kernel(framebuffer, 'point', false, 'mark').draw(pass, {
          vertexArray: this.vertices, vertexCount: 4, instanceCount: pointCount, bindings,
        })
      }
      const useSolid = !picking && this.canUseSolidLinks(view)
      const kind = useSolid ? (this.uniformLinkRgb ? 'uniformRgbLink' : 'solidLink') : 'link'
      this.kernel(framebuffer, kind, picking, coverLinks ? 'test' : 'none').draw(pass, {
        vertexArray: this.vertices, vertexCount: 2 * (segments + 1), instanceCount: this.linkCount, bindings,
      })
    }
    if (options.points === false) return
    this.kernel(framebuffer, 'point', picking).draw(pass, {
      vertexArray: this.vertices, vertexCount: 4, instanceCount: pointCount, bindings,
    })
  }
}
