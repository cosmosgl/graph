import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import drawLineFrag from '@/graph/modules/Lines/draw-curve-line.frag'
import drawLineVert from '@/graph/modules/Lines/draw-curve-line.vert'
import hoveredLineIndexFrag from '@/graph/modules/Lines/hovered-line-index.frag'
import hoveredLineIndexVert from '@/graph/modules/Lines/hovered-line-index.vert'
import { defaultConfigValues } from '@/graph/variables'
import { getCurveLineGeometry } from '@/graph/modules/Lines/geometry'

export class Lines extends CoreModule {
  public linkIndexFbo: regl.Framebuffer2D | undefined
  public hoveredLineIndexFbo: regl.Framebuffer2D | undefined
  private drawCurveCommand: regl.DrawCommand | undefined
  private hoveredLineIndexCommand: regl.DrawCommand | undefined
  private pointsBuffer: regl.Buffer | undefined
  private colorBuffer: regl.Buffer | undefined
  private widthBuffer: regl.Buffer | undefined
  private arrowBuffer: regl.Buffer | undefined
  private curveLineGeometry: number[][] | undefined
  private curveLineBuffer: regl.Buffer | undefined
  private linkIndexBuffer: regl.Buffer | undefined
  private quadBuffer: regl.Buffer | undefined

  public initPrograms (): void {
    const { reglInstance, config, store } = this

    this.updateLinkIndexFbo()

    // Initialize the hovered line index FBO
    if (!this.hoveredLineIndexFbo) {
      this.hoveredLineIndexFbo = reglInstance.framebuffer({
        color: reglInstance.texture({
          width: 1,
          height: 1,
          format: 'rgba',
          type: 'float',
        }),
        depth: false,
        stencil: false,
      })
    }

    if (!this.drawCurveCommand) {
      this.drawCurveCommand = reglInstance({
        vert: drawLineVert,
        frag: drawLineFrag,

        attributes: {
          position: {
            buffer: () => this.curveLineBuffer,
            divisor: 0,
          },
          pointA: {
            buffer: () => this.pointsBuffer,
            divisor: 1,
            offset: Float32Array.BYTES_PER_ELEMENT * 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 4,
          },
          pointB: {
            buffer: () => this.pointsBuffer,
            divisor: 1,
            offset: Float32Array.BYTES_PER_ELEMENT * 2,
            stride: Float32Array.BYTES_PER_ELEMENT * 4,
          },
          color: {
            buffer: () => this.colorBuffer,
            divisor: 1,
            offset: Float32Array.BYTES_PER_ELEMENT * 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 4,
          },
          width: {
            buffer: () => this.widthBuffer,
            divisor: 1,
            offset: Float32Array.BYTES_PER_ELEMENT * 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 1,
          },
          arrow: {
            buffer: () => this.arrowBuffer,
            divisor: 1,
            offset: Float32Array.BYTES_PER_ELEMENT * 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 1,
          },
          linkIndices: {
            buffer: () => this.linkIndexBuffer,
            divisor: 1,
            offset: Float32Array.BYTES_PER_ELEMENT * 0,
            stride: Float32Array.BYTES_PER_ELEMENT * 1,
          },
        },
        uniforms: {
          positionsTexture: () => this.points?.currentPositionFbo,
          pointGreyoutStatus: () => this.points?.greyoutStatusFbo,
          transformationMatrix: () => store.transform,
          pointsTextureSize: () => store.pointsTextureSize,
          widthScale: () => config.linkWidthScale,
          arrowSizeScale: () => config.linkArrowsSizeScale,
          spaceSize: () => store.adjustedSpaceSize,
          screenSize: () => store.screenSize,
          linkVisibilityDistanceRange: () => config.linkVisibilityDistanceRange,
          linkVisibilityMinTransparency: () => config.linkVisibilityMinTransparency,
          linkOpacity: () => config.linkOpacity,
          greyoutOpacity: () => config.linkGreyoutOpacity,
          scaleLinksOnZoom: () => config.scaleLinksOnZoom,
          maxPointSize: () => store.maxPointSize,
          curvedWeight: () => config.curvedLinkWeight,
          curvedLinkControlPointDistance: () => config.curvedLinkControlPointDistance,
          curvedLinkSegments: () => config.curvedLinks ? config.curvedLinkSegments ?? defaultConfigValues.curvedLinkSegments : 1,
          hoveredLinkIndex: () => store.hoveredLinkIndex ?? -1,
          renderMode: reglInstance.prop<{ renderMode: number }, 'renderMode'>('renderMode'),
        },
        cull: {
          enable: true,
          face: 'back',
        },
        blend: {
          enable: true,
          func: {
            dstRGB: 'one minus src alpha',
            srcRGB: 'src alpha',
            dstAlpha: 'one minus src alpha',
            srcAlpha: 'one',
          },
          equation: {
            rgb: 'add',
            alpha: 'add',
          },
        },
        depth: {
          enable: false,
          mask: false,
        },
        framebuffer: reglInstance.prop<{ framebuffer: regl.Framebuffer2D }, 'framebuffer'>('framebuffer'),
        count: () => this.curveLineGeometry?.length ?? 0,
        instances: () => this.data.linksNumber ?? 0,
        primitive: 'triangle strip',
      })
    }

    if (!this.hoveredLineIndexCommand) {
      this.hoveredLineIndexCommand = reglInstance({
        vert: hoveredLineIndexVert,
        frag: hoveredLineIndexFrag,
        attributes: {
          position: {
            buffer: () => this.quadBuffer,
          },
        },
        uniforms: {
          linkIndexTexture: () => this.linkIndexFbo,
          mousePosition: () => store.screenMousePosition,
          screenSize: () => store.screenSize,
        },
        framebuffer: this.hoveredLineIndexFbo,
        count: 4,
        primitive: 'triangle strip',
      })
    }

    // Initialize quad buffer for full-screen rendering
    if (!this.quadBuffer) {
      this.quadBuffer = reglInstance.buffer([-1, -1, 1, -1, -1, 1, 1, 1])
    }
  }

  public draw (): void {
    if (!this.pointsBuffer) return
    if (!this.colorBuffer) this.updateColor()
    if (!this.widthBuffer) this.updateWidth()
    if (!this.arrowBuffer) this.updateArrow()
    if (!this.curveLineGeometry) this.updateCurveLineGeometry()

    // Render normal links (renderMode: 0.0 = normal rendering)
    this.drawCurveCommand?.({ framebuffer: null, renderMode: 0.0 })
  }

  public updateLinkIndexFbo (): void {
    const { reglInstance, store } = this

    if (!this.linkIndexFbo) this.linkIndexFbo = reglInstance.framebuffer()
    this.linkIndexFbo({
      color: reglInstance.texture({
        width: store.screenSize[0],
        height: store.screenSize[1],
        format: 'rgba',
        type: 'float',
      }),
      depth: false,
      stencil: false,
    })
  }

  public updatePointsBuffer (): void {
    const { reglInstance, data, store } = this
    if (data.linksNumber === undefined || data.links === undefined) return
    const instancePoints = new Float32Array(data.linksNumber * 4)
    for (let i = 0; i < data.linksNumber; i++) {
      const fromIndex = data.links[i * 2] as number
      const toIndex = data.links[i * 2 + 1] as number
      const fromX = fromIndex % store.pointsTextureSize
      const fromY = Math.floor(fromIndex / store.pointsTextureSize)
      const toX = toIndex % store.pointsTextureSize
      const toY = Math.floor(toIndex / store.pointsTextureSize)
      const offset = i * 4
      instancePoints[offset] = fromX
      instancePoints[offset + 1] = fromY
      instancePoints[offset + 2] = toX
      instancePoints[offset + 3] = toY
    }

    if (!this.pointsBuffer) this.pointsBuffer = reglInstance.buffer(0)
    this.pointsBuffer(instancePoints)

    const linkIndices = new Float32Array(data.linksNumber)
    for (let i = 0; i < data.linksNumber; i++) {
      linkIndices[i] = i
    }
    if (!this.linkIndexBuffer) this.linkIndexBuffer = reglInstance.buffer(0)
    this.linkIndexBuffer(linkIndices)
  }

  public updateColor (): void {
    const { reglInstance, data } = this
    if (!this.colorBuffer) this.colorBuffer = reglInstance.buffer(0)
    this.colorBuffer(data.linkColors ?? new Float32Array())
  }

  public updateWidth (): void {
    const { reglInstance, data } = this
    if (!this.widthBuffer) this.widthBuffer = reglInstance.buffer(0)
    this.widthBuffer(data.linkWidths ?? new Float32Array())
  }

  public updateArrow (): void {
    const { reglInstance, data } = this
    if (!this.arrowBuffer) this.arrowBuffer = reglInstance.buffer(0)
    this.arrowBuffer(data.linkArrows ?? new Float32Array())
  }

  public updateCurveLineGeometry (): void {
    const { reglInstance, config: { curvedLinks, curvedLinkSegments } } = this
    this.curveLineGeometry = getCurveLineGeometry(curvedLinks ? curvedLinkSegments ?? defaultConfigValues.curvedLinkSegments : 1)
    if (!this.curveLineBuffer) this.curveLineBuffer = reglInstance.buffer(0)
    this.curveLineBuffer(this.curveLineGeometry)
  }

  public findHoveredLine (): void {
    if (!this.data.linksNumber) return
    if (!this.linkIndexFbo) this.updateLinkIndexFbo()
    this.reglInstance.clear({
      framebuffer: this.linkIndexFbo as regl.Framebuffer2D,
      color: [0, 0, 0, 0],
    })
    // Render to index buffer for picking/hover detection (renderMode: 1.0 = index rendering)
    this.drawCurveCommand?.({ framebuffer: this.linkIndexFbo, renderMode: 1.0 })

    // Execute the command to read the link index at mouse position
    this.hoveredLineIndexCommand?.()
  }
}
