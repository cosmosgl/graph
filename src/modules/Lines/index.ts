import { Framebuffer, Buffer, Texture, UniformStore, RenderPass, type RenderPipelineParameters } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import type { Mat4Array } from '@/graph/modules/Store'
import { conicParametricCurveModule } from '@/graph/modules/Lines/conic-curve-module'
import drawLineFrag from '@/graph/modules/Lines/draw-curve-line.frag?raw'
import drawLineVert from '@/graph/modules/Lines/draw-curve-line.vert?raw'
import fillGridWithSampledLinksFrag from '@/graph/modules/Lines/fill-sampled-links.frag?raw'
import fillGridWithSampledLinksVert from '@/graph/modules/Lines/fill-sampled-links.vert?raw'
import hoveredLineIndexFrag from '@/graph/modules/Lines/hovered-line-index.frag?raw'
import hoveredLineIndexVert from '@/graph/modules/Lines/hovered-line-index.vert?raw'
import { defaultConfigValues, EXIT_DEFAULT_COLOR_CHANNEL } from '@/graph/variables'
import { getCurveLineGeometry } from '@/graph/modules/Lines/geometry'
import { updateAttributeBuffers } from '@/graph/modules/Shared/buffer'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import { ensureVec2, ensureVec4 } from '@/graph/modules/Shared/uniform-utils'
import { readPixels, getRgbaColor } from '@/graph/helper'

// GLSL requires float literals in #define'd expressions ("0" would be an int)
const glslFloatLiteral = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value))

type DrawCurveCommandAttributes = {
  position?: Buffer;
  pointA?: Buffer;
  pointB?: Buffer;
  sourceColor?: Buffer;
  targetColor?: Buffer;
  sourceWidth?: Buffer;
  targetWidth?: Buffer;
  arrow?: Buffer;
  linkIndices?: Buffer;
  linkStyle?: Buffer;
}

export class Lines extends CoreModule {
  public linkIndexFbo: Framebuffer | undefined
  public hoveredLineIndexFbo: Framebuffer | undefined
  public sampledLinksFbo: Framebuffer | undefined
  public linkStatusTexture: Texture | undefined
  private linkStatusTextureSize = 0
  private drawCurveCommand: Model | undefined
  private drawCurvePickingCommand: Model | undefined
  private isLinkBlendingActive: boolean | undefined
  private hoveredLineIndexCommand: Model | undefined
  private fillSampledLinksFboCommand: Model | undefined
  private pointABuffer: Buffer | undefined
  private pointBBuffer: Buffer | undefined
  private sourceColorBuffer: Buffer | undefined
  private targetColorBuffer: Buffer | undefined
  private previousColorData: Float32Array | undefined
  private sourceWidthBuffer: Buffer | undefined
  private targetWidthBuffer: Buffer | undefined
  private previousWidthData: Float32Array | undefined
  private arrowBuffer: Buffer | undefined
  private linkStyleBuffer: Buffer | undefined
  private curveLineGeometry: number[][] | undefined
  private curveLineBuffer: Buffer | undefined
  private linkIndexBuffer: Buffer | undefined
  private quadBuffer: Buffer | undefined
  private linkIndexTexture: Texture | undefined
  private hoveredLineIndexTexture: Texture | undefined
  private transitionProgress = 1
  private shouldAnimateLinkColors = false
  private shouldAnimateLinkWidths = false
  private shouldAnimatePositions = false
  private fillSampledLinksUniformStore: UniformStore<{
    fillSampledLinksUniforms: {
      pointsTextureSize: number;
      transformationMatrix: Mat4Array;
      spaceSize: number;
      screenSize: [number, number];
      curvedWeight: number;
      curvedLinkControlPointDistance: number;
      curvedLinkSegments: number;
    };
  }> | undefined

  // Uniform stores for scalar uniforms
  private drawLineUniformStore: UniformStore<{
    drawLineUniforms: {
      transformationMatrix: Mat4Array;
      pointsTextureSize: number;
      widthScale: number;
      linkArrowsSizeScale: number;
      spaceSize: number;
      screenSize: [number, number];
      linkVisibilityDistanceRange: [number, number];
      linkVisibilityMinTransparency: number;
      linkOpacity: number;
      greyoutOpacity: number;
      curvedWeight: number;
      curvedLinkControlPointDistance: number;
      curvedLinkSegments: number;
      scaleLinksOnZoom: number;
      maxPointSize: number;
      renderMode: number;
      hoveredLinkIndex: number;
      hoveredLinkWidthIncrease: number;
      isLinkHighlightingActive: number;
      linkStatusTextureSize: number;
      focusedLinkIndex: number;
      focusedLinkWidthIncrease: number;
      transitionProgress: number;
      animateColors: number;
      animateWidths: number;
      animatePositions: number;
      pointDefaultColor: [number, number, number, number];
      linkColorInterpolateFromEndpoints: number;
    };
    drawLineFragmentUniforms: {
      renderMode: number;
      linkDashLength: number;
      linkDashGap: number;
      linkColorInterpolateFromEndpoints: number;
      hoveredLinkIndex: number;
      hoveredLinkColor: [number, number, number, number];
    };
  }> | undefined

  private hoveredLineIndexUniformStore: UniformStore<{
    hoveredLineIndexUniforms: {
      mousePosition: [number, number];
      screenSize: [number, number];
    };
  }> | undefined

  // Track previous screen size to detect changes
  private previousScreenSize: [number, number] | undefined

  public initPrograms (): void {
    const { device, config, store, data } = this

    this.updateLinkIndexFbo()

    // Initialize the hovered line index FBO
    this.hoveredLineIndexTexture ||= device.createTexture({
      width: 1,
      height: 1,
      format: 'rgba32float',
      usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      data: new Float32Array(4).fill(0),
    })
    this.hoveredLineIndexFbo ||= device.createFramebuffer({
      width: 1,
      height: 1,
      colorAttachments: [this.hoveredLineIndexTexture],
    })

    // Ensure geometry buffer exists (create empty if needed)
    if (!this.curveLineGeometry) {
      this.updateCurveLineGeometry()
    }

    // Ensure all attribute buffers exist (create empty if needed) so Model has all attributes
    const linksNumber = this.data.linksNumber ?? 0
    this.pointABuffer ||= device.createBuffer({
      data: new Float32Array(linksNumber * 2),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })
    this.pointBBuffer ||= device.createBuffer({
      data: new Float32Array(linksNumber * 2),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })
    this.arrowBuffer ||= device.createBuffer({
      data: new Float32Array(linksNumber),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })
    this.linkStyleBuffer ||= device.createBuffer({
      data: new Float32Array(linksNumber),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })
    this.linkIndexBuffer ||= device.createBuffer({
      data: new Float32Array(linksNumber),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })

    // Create UniformStore for drawLine uniforms
    this.drawLineUniformStore ||= new UniformStore({
      drawLineUniforms: {
        uniformTypes: {
          transformationMatrix: 'mat4x4<f32>',
          pointsTextureSize: 'f32',
          widthScale: 'f32',
          linkArrowsSizeScale: 'f32',
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
          linkVisibilityDistanceRange: 'vec2<f32>',
          linkVisibilityMinTransparency: 'f32',
          linkOpacity: 'f32',
          greyoutOpacity: 'f32',
          curvedWeight: 'f32',
          curvedLinkControlPointDistance: 'f32',
          curvedLinkSegments: 'f32',
          scaleLinksOnZoom: 'f32',
          maxPointSize: 'f32',
          renderMode: 'f32',
          hoveredLinkIndex: 'f32',
          hoveredLinkWidthIncrease: 'f32',
          isLinkHighlightingActive: 'f32',
          linkStatusTextureSize: 'f32',
          focusedLinkIndex: 'f32',
          focusedLinkWidthIncrease: 'f32',
          transitionProgress: 'f32',
          animateColors: 'f32',
          animateWidths: 'f32',
          animatePositions: 'f32',
          pointDefaultColor: 'vec4<f32>',
          linkColorInterpolateFromEndpoints: 'f32',
        },
        defaultUniforms: {
          transformationMatrix: store.transformationMatrix4x4,
          pointsTextureSize: store.pointsTextureSize,
          widthScale: config.linkWidthScale,
          linkArrowsSizeScale: config.linkArrowsSizeScale,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          linkVisibilityDistanceRange: ensureVec2(config.linkVisibilityDistanceRange, [0, 0]),
          linkVisibilityMinTransparency: config.linkVisibilityMinTransparency,
          linkOpacity: config.linkOpacity,
          greyoutOpacity: config.linkGreyoutOpacity,
          curvedWeight: config.curvedLinkWeight,
          curvedLinkControlPointDistance: config.curvedLinkControlPointDistance,
          curvedLinkSegments: config.curvedLinks ? config.curvedLinkSegments : 1,
          scaleLinksOnZoom: config.scaleLinksOnZoom ? 1 : 0,
          maxPointSize: store.maxPointSize,
          renderMode: 0.0,
          hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
          hoveredLinkWidthIncrease: config.hoveredLinkWidthIncrease,
          isLinkHighlightingActive: 0,
          linkStatusTextureSize: 0,
          focusedLinkIndex: config.focusedLinkIndex ?? -1,
          focusedLinkWidthIncrease: config.focusedLinkWidthIncrease,
          transitionProgress: 1,
          animateColors: 0,
          animateWidths: 0,
          animatePositions: 0,
          pointDefaultColor: ensureVec4(getRgbaColor(config.pointDefaultColor), [0, 0, 0, 1]),
          linkColorInterpolateFromEndpoints: config.linkColorInterpolateFromEndpoints ? 1 : 0,
        },
      },
      drawLineFragmentUniforms: {
        uniformTypes: {
          renderMode: 'f32',
          linkDashLength: 'f32',
          linkDashGap: 'f32',
          linkColorInterpolateFromEndpoints: 'f32',
          hoveredLinkIndex: 'f32',
          hoveredLinkColor: 'vec4<f32>',
        },
        defaultUniforms: {
          renderMode: 0.0,
          linkDashLength: config.linkDashLength,
          linkDashGap: config.linkDashGap,
          linkColorInterpolateFromEndpoints: config.linkColorInterpolateFromEndpoints ? 1 : 0,
          hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
          hoveredLinkColor: ensureVec4(store.hoveredLinkColor, [-1, -1, -1, -1]),
        },
      },
    })

    this.drawCurveCommand ||= this.createDrawCurveCommand(this.getLinkBlendParameters(this.config.linkBlending))

    this.isLinkBlendingActive = this.config.linkBlending

    // Initialize quad buffer for full-screen rendering
    this.quadBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })

    this.hoveredLineIndexUniformStore ||= new UniformStore({
      hoveredLineIndexUniforms: {
        uniformTypes: {
          mousePosition: 'vec2<f32>',
          screenSize: 'vec2<f32>',
        },
        defaultUniforms: {
          mousePosition: ensureVec2(store.screenMousePosition, [0, 0]),
          screenSize: ensureVec2(store.screenSize, [0, 0]),
        },
      },
    })

    this.hoveredLineIndexCommand ||= new Model(device, {
      vs: hoveredLineIndexVert,
      fs: hoveredLineIndexFrag,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.quadBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        hoveredLineIndexUniforms: this.hoveredLineIndexUniformStore.getManagedUniformBuffer(device, 'hoveredLineIndexUniforms'),
        // All texture bindings will be set dynamically in findHoveredLine() method
      },
    })

    // Sampled links (for getSampledLinks / getSampledLinkPositionsMap)
    this.fillSampledLinksUniformStore ||= new UniformStore({
      fillSampledLinksUniforms: {
        uniformTypes: {
          pointsTextureSize: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
          curvedWeight: 'f32',
          curvedLinkControlPointDistance: 'f32',
          curvedLinkSegments: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          transformationMatrix: store.transformationMatrix4x4,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          curvedWeight: config.curvedLinkWeight,
          curvedLinkControlPointDistance: config.curvedLinkControlPointDistance,
          curvedLinkSegments: config.curvedLinks ? config.curvedLinkSegments : 1,
        },
      },
    })

    this.fillSampledLinksFboCommand ||= new Model(device, {
      fs: fillGridWithSampledLinksFrag,
      vs: fillGridWithSampledLinksVert,
      modules: [conicParametricCurveModule],
      topology: 'point-list',
      vertexCount: data.linksNumber ?? 0,
      attributes: {
        ...(this.pointABuffer && { pointA: this.pointABuffer }),
        ...(this.pointBBuffer && { pointB: this.pointBBuffer }),
        ...(this.linkIndexBuffer && { linkIndices: this.linkIndexBuffer }),
      },
      bufferLayout: [
        { name: 'pointA', format: 'float32x2' },
        { name: 'pointB', format: 'float32x2' },
        { name: 'linkIndices', format: 'float32' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        fillSampledLinksUniforms: this.fillSampledLinksUniformStore.getManagedUniformBuffer(device, 'fillSampledLinksUniforms'),
      },
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
        blend: false,
      },
    })

    this.updateSampledLinksGrid()
    this.updateLinkStatus()
  }

  public draw (renderPass: RenderPass): void {
    const { config, points, store } = this
    if (!points) return
    if (!points.currentPositionTexture || points.currentPositionTexture.destroyed) return
    if (!points.exitTexture) points.updateExit()
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!this.pointABuffer || !this.pointBBuffer) this.updatePointsBuffer()
    if (!this.targetColorBuffer) this.updateColor()
    if (!this.targetWidthBuffer) this.updateWidth()
    if (!this.arrowBuffer) this.updateArrow()
    if (!this.linkStyleBuffer) this.updateStyle()
    if (!this.curveLineGeometry) this.updateCurveLineGeometry()
    if (!this.drawCurveCommand || !this.drawLineUniformStore || !this.linkStatusTexture) return

    this.updateLinkBlending()

    const hasHighlighting = config.highlightedLinkIndices !== undefined

    // Update uniforms
    this.drawLineUniformStore.setUniforms({
      drawLineUniforms: {
        transformationMatrix: store.transformationMatrix4x4,
        pointsTextureSize: store.pointsTextureSize,
        widthScale: config.linkWidthScale,
        linkArrowsSizeScale: config.linkArrowsSizeScale,
        spaceSize: store.adjustedSpaceSize,
        screenSize: ensureVec2(store.screenSize, [0, 0]),
        linkVisibilityDistanceRange: ensureVec2(config.linkVisibilityDistanceRange, [0, 0]),
        linkVisibilityMinTransparency: config.linkVisibilityMinTransparency,
        linkOpacity: config.linkOpacity,
        greyoutOpacity: config.linkGreyoutOpacity,
        curvedWeight: config.curvedLinkWeight,
        curvedLinkControlPointDistance: config.curvedLinkControlPointDistance,
        curvedLinkSegments: config.curvedLinks ? config.curvedLinkSegments : 1,
        scaleLinksOnZoom: config.scaleLinksOnZoom ? 1 : 0,
        maxPointSize: store.maxPointSize,
        renderMode: 0.0, // Normal rendering
        hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
        hoveredLinkWidthIncrease: config.hoveredLinkWidthIncrease,
        isLinkHighlightingActive: hasHighlighting ? 1 : 0,
        linkStatusTextureSize: this.linkStatusTextureSize,
        focusedLinkIndex: config.focusedLinkIndex ?? -1,
        focusedLinkWidthIncrease: config.focusedLinkWidthIncrease,
        transitionProgress: this.transitionProgress,
        animateColors: this.shouldAnimateLinkColors ? 1 : 0,
        animateWidths: this.shouldAnimateLinkWidths ? 1 : 0,
        animatePositions: this.shouldAnimatePositions ? 1 : 0,
        // Cached parse — draw() runs per frame, so no color-string parsing here.
        pointDefaultColor: ensureVec4(this.data.defaultRgba, [0, 0, 0, 1]),
        linkColorInterpolateFromEndpoints: config.linkColorInterpolateFromEndpoints ? 1 : 0,
      },
      drawLineFragmentUniforms: {
        renderMode: 0.0, // Normal rendering
        linkDashLength: config.linkDashLength,
        linkDashGap: config.linkDashGap,
        linkColorInterpolateFromEndpoints: config.linkColorInterpolateFromEndpoints ? 1 : 0,
        hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
        hoveredLinkColor: ensureVec4(store.hoveredLinkColor, [-1, -1, -1, -1]),
      },
    })

    // Update texture bindings dynamically
    this.drawCurveCommand.setBindings({
      positionsTexture: points.currentPositionTexture,
      linkStatus: this.linkStatusTexture,
      exitTexture: points.exitTexture,
      // Endpoint colors for gradient links. The sampler must always have a valid texture
      // bound, but the stand-in is never sampled: with the gradient off the vertex shader
      // skips the fetches, and with it on Points.updateColor() has built the real texture
      // (initial create runs it before the first draw; runtime toggles go through
      // updateStateFromConfig, which re-runs it on the flag change).
      pointColorsTexture: points.pointColorsTexture ?? points.currentPositionTexture,
    })

    // Update instance count
    this.drawCurveCommand.setInstanceCount(this.data.linksNumber ?? 0)

    // Render normal links
    this.drawCurveCommand.draw(renderPass)
  }

  public updateLinkIndexFbo (): void {
    const { device, store } = this

    // Only create and update the link index FBO if link hovering is enabled
    if (!this.store.isLinkHoveringEnabled) return

    const screenSize = store.screenSize ?? [0, 0]
    const screenWidth = screenSize[0]
    const screenHeight = screenSize[1]

    // Avoid invalid uploads when size is zero
    if (!screenWidth || !screenHeight) return

    // Check if screen size changed
    const screenSizeChanged =
      this.previousScreenSize?.[0] !== screenWidth ||
      this.previousScreenSize?.[1] !== screenHeight

    if (!this.linkIndexTexture || screenSizeChanged) {
      // Destroy old framebuffer and texture if they exist
      if (this.linkIndexFbo && !this.linkIndexFbo.destroyed) {
        this.linkIndexFbo.destroy()
      }
      if (this.linkIndexTexture && !this.linkIndexTexture.destroyed) {
        this.linkIndexTexture.destroy()
      }

      // Create new texture
      this.linkIndexTexture = device.createTexture({
        width: screenWidth,
        height: screenHeight,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      this.linkIndexTexture.copyImageData({
        data: new Float32Array(screenWidth * screenHeight * 4).fill(0),
        bytesPerRow: getBytesPerRow('rgba32float', screenWidth),
        mipLevel: 0,
        x: 0,
        y: 0,
      })

      // Create new framebuffer
      this.linkIndexFbo = device.createFramebuffer({
        width: screenWidth,
        height: screenHeight,
        colorAttachments: [this.linkIndexTexture],
      })

      this.previousScreenSize = [screenWidth, screenHeight]
    }
  }

  public updateSampledLinksGrid (): void {
    const { store: { screenSize }, config: { linkSamplingDistance }, device } = this
    let dist = linkSamplingDistance ?? Math.min(...screenSize) / 2
    if (dist === 0) dist = defaultConfigValues.linkSamplingDistance
    const w = Math.ceil(screenSize[0] / dist)
    const h = Math.ceil(screenSize[1] / dist)
    if (w === 0 || h === 0) return

    if (!this.sampledLinksFbo || this.sampledLinksFbo.width !== w || this.sampledLinksFbo.height !== h) {
      if (this.sampledLinksFbo && !this.sampledLinksFbo.destroyed) {
        this.sampledLinksFbo.destroy()
      }
      this.sampledLinksFbo = device.createFramebuffer({
        width: w,
        height: h,
        colorAttachments: ['rgba32float'],
      })
    }
  }

  public updatePointsBuffer (): void {
    const { device, data, store } = this
    if (data.linksNumber === undefined || data.links === undefined) return
    if (!store.pointsTextureSize) return // Guard against 0/undefined

    // Create separate buffers for pointA and pointB
    const pointAData = new Float32Array(data.linksNumber * 2)
    const pointBData = new Float32Array(data.linksNumber * 2)

    for (let i = 0; i < data.linksNumber; i++) {
      const fromIndex = data.links[i * 2] as number
      const toIndex = data.links[i * 2 + 1] as number
      const fromX = fromIndex % store.pointsTextureSize
      const fromY = Math.floor(fromIndex / store.pointsTextureSize)
      const toX = toIndex % store.pointsTextureSize
      const toY = Math.floor(toIndex / store.pointsTextureSize)

      pointAData[i * 2] = fromX
      pointAData[i * 2 + 1] = fromY
      pointBData[i * 2] = toX
      pointBData[i * 2 + 1] = toY
    }

    // Check if buffer needs to be resized (buffers can't be resized, need to recreate)
    const currentSize = (this.pointABuffer?.byteLength ?? 0) / (Float32Array.BYTES_PER_ELEMENT * 2)
    if (!this.pointABuffer || currentSize !== data.linksNumber) {
      if (this.pointABuffer && !this.pointABuffer.destroyed) {
        this.pointABuffer.destroy()
      }
      this.pointABuffer = device.createBuffer({
        data: pointAData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
      // Note: Model attributes are set at creation time, so if Model exists and buffer is recreated,
      // the Model will need to be recreated too. For now, we ensure buffers exist before initPrograms.
    } else {
      this.pointABuffer.write(pointAData)
    }

    if (!this.pointBBuffer || currentSize !== data.linksNumber) {
      if (this.pointBBuffer && !this.pointBBuffer.destroyed) {
        this.pointBBuffer.destroy()
      }
      this.pointBBuffer = device.createBuffer({
        data: pointBData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.pointBBuffer.write(pointBData)
    }

    const linkIndices = new Float32Array(data.linksNumber)
    for (let i = 0; i < data.linksNumber; i++) {
      linkIndices[i] = i
    }
    if (!this.linkIndexBuffer || currentSize !== data.linksNumber) {
      if (this.linkIndexBuffer && !this.linkIndexBuffer.destroyed) {
        this.linkIndexBuffer.destroy()
      }
      this.linkIndexBuffer = device.createBuffer({
        data: linkIndices,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.linkIndexBuffer.write(linkIndices)
    }
    this.setDrawCurveCommandAttributes({
      pointA: this.pointABuffer,
      pointB: this.pointBBuffer,
      linkIndices: this.linkIndexBuffer,
    })
    if (this.fillSampledLinksFboCommand) {
      this.fillSampledLinksFboCommand.setAttributes({
        pointA: this.pointABuffer,
        pointB: this.pointBBuffer,
        linkIndices: this.linkIndexBuffer,
      })
    }

    this.updateSampledLinksGrid()
    if (this.config.highlightedLinkIndices !== undefined) this.updateLinkStatus()
  }

  public updateColor (): void {
    const { data } = this
    const linksNumber = data.linksNumber ?? 0
    const colorData = data.linkColors ?? new Float32Array(linksNumber * 4).fill(0)
    const { source, target, previous } = updateAttributeBuffers(
      this.device,
      colorData,
      this.sourceColorBuffer,
      this.targetColorBuffer,
      this.previousColorData,
      4
    )
    this.sourceColorBuffer = source
    this.targetColorBuffer = target
    this.previousColorData = previous

    this.setDrawCurveCommandAttributes({
      ...(this.sourceColorBuffer && { sourceColor: this.sourceColorBuffer }),
      ...(this.targetColorBuffer && { targetColor: this.targetColorBuffer }),
    })
  }

  public updateWidth (): void {
    const { data } = this
    const linksNumber = data.linksNumber ?? 0
    const widthData = data.linkWidths ?? new Float32Array(linksNumber).fill(0)
    const { source, target, previous } = updateAttributeBuffers(
      this.device,
      widthData,
      this.sourceWidthBuffer,
      this.targetWidthBuffer,
      this.previousWidthData,
      1
    )
    this.sourceWidthBuffer = source
    this.targetWidthBuffer = target
    this.previousWidthData = previous

    this.setDrawCurveCommandAttributes({
      ...(this.sourceWidthBuffer && { sourceWidth: this.sourceWidthBuffer }),
      ...(this.targetWidthBuffer && { targetWidth: this.targetWidthBuffer }),
    })
  }

  public updateArrow (): void {
    const { device, data } = this
    // linkArrows is number[] not Float32Array, so we need to convert it
    // Ensure we have the right size even if linkArrows is undefined
    const linksNumber = data.linksNumber ?? 0
    const arrowData = data.linkArrows
      ? new Float32Array(data.linkArrows)
      : new Float32Array(linksNumber).fill(0)

    if (!this.arrowBuffer) {
      this.arrowBuffer = device.createBuffer({
        data: arrowData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      // Check if buffer needs to be resized
      const currentSize = (this.arrowBuffer.byteLength ?? 0) / Float32Array.BYTES_PER_ELEMENT
      if (currentSize !== linksNumber) {
        if (this.arrowBuffer && !this.arrowBuffer.destroyed) {
          this.arrowBuffer.destroy()
        }
        this.arrowBuffer = device.createBuffer({
          data: arrowData,
          usage: Buffer.VERTEX | Buffer.COPY_DST,
        })
      } else {
        this.arrowBuffer.write(arrowData)
      }
    }
    this.setDrawCurveCommandAttributes({ arrow: this.arrowBuffer })
  }

  public updateStyle (): void {
    const { device, data } = this
    const linksNumber = data.linksNumber ?? 0
    const styleData = data.linkStyles
      ? new Float32Array(data.linkStyles)
      : new Float32Array(linksNumber).fill(0)

    if (!this.linkStyleBuffer) {
      this.linkStyleBuffer = device.createBuffer({
        data: styleData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      // Check if buffer needs to be resized
      const currentSize = (this.linkStyleBuffer.byteLength ?? 0) / Float32Array.BYTES_PER_ELEMENT
      if (currentSize !== linksNumber) {
        if (this.linkStyleBuffer && !this.linkStyleBuffer.destroyed) {
          this.linkStyleBuffer.destroy()
        }
        this.linkStyleBuffer = device.createBuffer({
          data: styleData,
          usage: Buffer.VERTEX | Buffer.COPY_DST,
        })
      } else {
        this.linkStyleBuffer.write(styleData)
      }
    }
    this.setDrawCurveCommandAttributes({ linkStyle: this.linkStyleBuffer })
  }

  public updateLinkStatus (): void {
    const { device, config, data } = this
    const linksNumber = data.linksNumber ?? 0

    // No links yet — ensure a placeholder texture exists so luma.gl always has
    // a valid binding for the linkStatus sampler (it silently skips the draw
    // call if any declared sampler is unbound).
    if (!linksNumber) {
      if (!this.linkStatusTexture) this.ensureLinkStatusPlaceholder()
      return
    }

    const { highlightedLinkIndices } = config

    // Highlighting cleared — keep the existing texture to avoid GPU alloc churn,
    // but set the size to 0 so the shader knows not to sample it
    // (the isLinkHighlightingActive uniform is set to 0 when highlighting is off).
    // If no texture exists yet (first call), create a 1×1 placeholder.
    if (highlightedLinkIndices === undefined) {
      if (!this.linkStatusTexture) this.ensureLinkStatusPlaceholder()
      this.linkStatusTextureSize = 0
      return
    }

    // Calculate texture size (square texture large enough for all links)
    const textureSize = Math.ceil(Math.sqrt(linksNumber))
    this.linkStatusTextureSize = textureSize

    const state = new Float32Array(textureSize * textureSize * 4)

    // Mark all links as greyed out (R=1)
    for (let i = 0; i < linksNumber; i++) {
      state[i * 4] = 1
    }
    // Un-grey highlighted links
    for (const idx of highlightedLinkIndices) {
      if (idx >= 0 && idx < linksNumber) {
        state[idx * 4] = 0
      }
    }

    const copyData = {
      data: state,
      bytesPerRow: getBytesPerRow('rgba32float', textureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    }

    if (!this.linkStatusTexture || this.linkStatusTexture.width !== textureSize || this.linkStatusTexture.height !== textureSize) {
      if (this.linkStatusTexture && !this.linkStatusTexture.destroyed) {
        this.linkStatusTexture.destroy()
      }
      this.linkStatusTexture = device.createTexture({
        width: textureSize,
        height: textureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      this.linkStatusTexture.copyImageData(copyData)
    } else {
      this.linkStatusTexture.copyImageData(copyData)
    }
  }

  public updateCurveLineGeometry (): void {
    const { device, config: { curvedLinks, curvedLinkSegments } } = this
    this.curveLineGeometry = getCurveLineGeometry(curvedLinks ? curvedLinkSegments : 1)

    // Flatten the 2D array to 1D
    const flatGeometry = new Float32Array(this.curveLineGeometry.length * 2)
    for (let i = 0; i < this.curveLineGeometry.length; i++) {
      flatGeometry[i * 2] = this.curveLineGeometry[i]![0]!
      flatGeometry[i * 2 + 1] = this.curveLineGeometry[i]![1]!
    }

    if (!this.curveLineBuffer || this.curveLineBuffer.byteLength !== flatGeometry.byteLength) {
      if (this.curveLineBuffer && !this.curveLineBuffer.destroyed) {
        this.curveLineBuffer.destroy()
      }
      this.curveLineBuffer = device.createBuffer({
        data: flatGeometry,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.curveLineBuffer.write(flatGeometry)
    }

    this.setDrawCurveCommandAttributes({ position: this.curveLineBuffer })
    this.drawCurveCommand?.setVertexCount(this.curveLineGeometry.length)
    this.drawCurvePickingCommand?.setVertexCount(this.curveLineGeometry.length)
  }

  /**
   * Re-applies the blend state to the link pipeline when `linkBlending` changes.
   * `setParameters` can trigger a pipeline rebuild, so this only runs on an actual change.
   */
  public updateLinkBlending (): void {
    const blend = this.config.linkBlending
    if (blend === this.isLinkBlendingActive) return
    this.drawCurveCommand?.setParameters(this.getLinkBlendParameters(blend))
    this.isLinkBlendingActive = blend
  }

  public getSampledLinkPositionsMap (): Map<number, [number, number, number]> {
    const positions = new Map<number, [number, number, number]>()
    if (!this.sampledLinksFbo || this.sampledLinksFbo.destroyed) return positions
    const points = this.points
    if (!points?.currentPositionTexture || points.currentPositionTexture.destroyed) return positions
    if (!points.exitTexture || points.exitTexture.destroyed) return positions

    if (this.fillSampledLinksFboCommand && this.fillSampledLinksUniformStore && this.sampledLinksFbo) {
      this.fillSampledLinksFboCommand.setVertexCount(this.data.linksNumber ?? 0)
      this.fillSampledLinksUniformStore.setUniforms({
        fillSampledLinksUniforms: {
          pointsTextureSize: this.store.pointsTextureSize ?? 0,
          transformationMatrix: this.store.transformationMatrix4x4,
          spaceSize: this.store.adjustedSpaceSize,
          screenSize: ensureVec2(this.store.screenSize, [0, 0]),
          curvedWeight: this.config.curvedLinkWeight,
          curvedLinkControlPointDistance: this.config.curvedLinkControlPointDistance,
          curvedLinkSegments: this.config.curvedLinks ? this.config.curvedLinkSegments : 1,
        },
      })
      this.fillSampledLinksFboCommand.setBindings({
        positionsTexture: points.currentPositionTexture,
        exitTexture: points.exitTexture,
      })

      const fillPass = this.device.beginRenderPass({
        framebuffer: this.sampledLinksFbo,
        clearColor: [-1, -1, -1, -1],
      })
      this.fillSampledLinksFboCommand.draw(fillPass)
      fillPass.end()
    }

    const pixels = readPixels(this.device, this.sampledLinksFbo)
    for (let i = 0; i < pixels.length / 4; i++) {
      const index = pixels[i * 4]
      const x = pixels[i * 4 + 1]
      const y = pixels[i * 4 + 2]
      const angle = pixels[i * 4 + 3]

      if (index !== undefined && index >= 0 && x !== undefined && y !== undefined && angle !== undefined) {
        positions.set(Math.round(index), [x, y, angle])
      }
    }
    return positions
  }

  public getSampledLinks (): { indices: number[]; positions: number[]; angles: number[] } {
    const indices: number[] = []
    const positions: number[] = []
    const angles: number[] = []
    if (!this.sampledLinksFbo || this.sampledLinksFbo.destroyed) return { indices, positions, angles }
    const points = this.points
    if (!points?.currentPositionTexture || points.currentPositionTexture.destroyed) return { indices, positions, angles }
    if (!points.exitTexture || points.exitTexture.destroyed) return { indices, positions, angles }

    if (this.fillSampledLinksFboCommand && this.fillSampledLinksUniformStore && this.sampledLinksFbo) {
      this.fillSampledLinksFboCommand.setVertexCount(this.data.linksNumber ?? 0)
      this.fillSampledLinksUniformStore.setUniforms({
        fillSampledLinksUniforms: {
          pointsTextureSize: this.store.pointsTextureSize ?? 0,
          transformationMatrix: this.store.transformationMatrix4x4,
          spaceSize: this.store.adjustedSpaceSize,
          screenSize: ensureVec2(this.store.screenSize, [0, 0]),
          curvedWeight: this.config.curvedLinkWeight,
          curvedLinkControlPointDistance: this.config.curvedLinkControlPointDistance,
          curvedLinkSegments: this.config.curvedLinks ? this.config.curvedLinkSegments : 1,
        },
      })
      this.fillSampledLinksFboCommand.setBindings({
        positionsTexture: points.currentPositionTexture,
        exitTexture: points.exitTexture,
      })

      const fillPass = this.device.beginRenderPass({
        framebuffer: this.sampledLinksFbo,
        clearColor: [-1, -1, -1, -1],
      })
      this.fillSampledLinksFboCommand.draw(fillPass)
      fillPass.end()
    }

    const pixels = readPixels(this.device, this.sampledLinksFbo)
    for (let i = 0; i < pixels.length / 4; i++) {
      const index = pixels[i * 4]
      const x = pixels[i * 4 + 1]
      const y = pixels[i * 4 + 2]
      const angle = pixels[i * 4 + 3]

      if (index !== undefined && index >= 0 && x !== undefined && y !== undefined && angle !== undefined) {
        indices.push(Math.round(index))
        positions.push(x, y)
        angles.push(angle)
      }
    }
    return { indices, positions, angles }
  }

  public findHoveredLine (): void {
    const { config, points, store } = this
    if (!points) return
    if (!points.currentPositionTexture || points.currentPositionTexture.destroyed) return
    if (!points.exitTexture) points.updateExit()
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!this.data.linksNumber || !this.store.isLinkHoveringEnabled) return
    if (!this.linkIndexFbo || !this.drawLineUniformStore || !this.linkStatusTexture) return
    if (!this.linkIndexTexture || this.linkIndexTexture.destroyed) return

    // Lazily create the picking command (only needed once hovering is in use). It is always
    // unblended so the index pass writes exact link index values without blending corrupting them.
    this.drawCurvePickingCommand ||= this.createDrawCurveCommand(this.getLinkBlendParameters(false))

    const hasHighlighting = config.highlightedLinkIndices !== undefined

    // Update uniforms for index rendering
    this.drawLineUniformStore.setUniforms({
      drawLineUniforms: {
        transformationMatrix: store.transformationMatrix4x4,
        pointsTextureSize: store.pointsTextureSize,
        widthScale: config.linkWidthScale,
        linkArrowsSizeScale: config.linkArrowsSizeScale,
        spaceSize: store.adjustedSpaceSize,
        screenSize: ensureVec2(store.screenSize, [0, 0]),
        linkVisibilityDistanceRange: ensureVec2(config.linkVisibilityDistanceRange, [0, 0]),
        linkVisibilityMinTransparency: config.linkVisibilityMinTransparency,
        linkOpacity: config.linkOpacity,
        greyoutOpacity: config.linkGreyoutOpacity,
        curvedWeight: config.curvedLinkWeight,
        curvedLinkControlPointDistance: config.curvedLinkControlPointDistance,
        curvedLinkSegments: config.curvedLinks ? config.curvedLinkSegments : 1,
        scaleLinksOnZoom: config.scaleLinksOnZoom ? 1 : 0,
        maxPointSize: store.maxPointSize,
        renderMode: 1.0, // Index rendering for picking
        hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
        hoveredLinkWidthIncrease: config.hoveredLinkWidthIncrease,
        isLinkHighlightingActive: hasHighlighting ? 1 : 0,
        linkStatusTextureSize: this.linkStatusTextureSize,
        focusedLinkIndex: config.focusedLinkIndex ?? -1,
        focusedLinkWidthIncrease: config.focusedLinkWidthIncrease,
        transitionProgress: this.transitionProgress,
        animateColors: this.shouldAnimateLinkColors ? 1 : 0,
        animateWidths: this.shouldAnimateLinkWidths ? 1 : 0,
        animatePositions: this.shouldAnimatePositions ? 1 : 0,
        pointDefaultColor: ensureVec4(this.data.defaultRgba, [0, 0, 0, 1]),
        linkColorInterpolateFromEndpoints: config.linkColorInterpolateFromEndpoints ? 1 : 0,
      },
      drawLineFragmentUniforms: {
        renderMode: 1.0, // Index rendering for picking
        linkDashLength: config.linkDashLength,
        linkDashGap: config.linkDashGap,
        linkColorInterpolateFromEndpoints: config.linkColorInterpolateFromEndpoints ? 1 : 0,
        hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
        hoveredLinkColor: ensureVec4(store.hoveredLinkColor, [-1, -1, -1, -1]),
      },
    })

    // Update texture bindings dynamically
    this.drawCurvePickingCommand.setBindings({
      positionsTexture: points.currentPositionTexture,
      linkStatus: this.linkStatusTexture,
      exitTexture: points.exitTexture,
      // Never-sampled stand-in when the gradient is off; see the visible-pass binding.
      pointColorsTexture: points.pointColorsTexture ?? points.currentPositionTexture,
    })

    // Update instance count
    this.drawCurvePickingCommand.setInstanceCount(this.data.linksNumber ?? 0)

    // Render to index buffer for picking/hover detection
    const indexPass = this.device.beginRenderPass({
      framebuffer: this.linkIndexFbo,
      // Clear framebuffer to transparent black (luma.gl default would be opaque black)
      clearColor: [0, 0, 0, 0],
    })
    this.drawCurvePickingCommand.draw(indexPass)
    indexPass.end()

    if (this.hoveredLineIndexCommand && this.hoveredLineIndexFbo && this.hoveredLineIndexUniformStore) {
      this.hoveredLineIndexUniformStore.setUniforms({
        hoveredLineIndexUniforms: {
          mousePosition: ensureVec2(store.screenMousePosition, [0, 0]),
          screenSize: ensureVec2(store.screenSize, [0, 0]),
        },
      })

      // Update texture bindings dynamically
      this.hoveredLineIndexCommand.setBindings({
        linkIndexTexture: this.linkIndexTexture,
      })

      const hoverPass = this.device.beginRenderPass({
        framebuffer: this.hoveredLineIndexFbo,
      })
      this.hoveredLineIndexCommand.draw(hoverPass)
      hoverPass.end()
    }
  }

  public setTransitionProgress (progress: number, animateColors = false, animateWidths = false, animatePositions = false): void {
    this.transitionProgress = progress
    this.shouldAnimateLinkColors = animateColors
    this.shouldAnimateLinkWidths = animateWidths
    this.shouldAnimatePositions = animatePositions
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST (they destroy _gpuGeometry if exists, and _uniformStore)
    this.drawCurveCommand?.destroy()
    this.drawCurveCommand = undefined
    this.drawCurvePickingCommand?.destroy()
    this.drawCurvePickingCommand = undefined
    this.isLinkBlendingActive = undefined
    this.hoveredLineIndexCommand?.destroy()
    this.hoveredLineIndexCommand = undefined
    this.fillSampledLinksFboCommand?.destroy()
    this.fillSampledLinksFboCommand = undefined

    // 2. Destroy Framebuffers (before textures they reference)
    if (this.linkIndexFbo && !this.linkIndexFbo.destroyed) {
      this.linkIndexFbo.destroy()
    }
    this.linkIndexFbo = undefined
    if (this.sampledLinksFbo && !this.sampledLinksFbo.destroyed) {
      this.sampledLinksFbo.destroy()
    }
    this.sampledLinksFbo = undefined
    if (this.hoveredLineIndexFbo && !this.hoveredLineIndexFbo.destroyed) {
      this.hoveredLineIndexFbo.destroy()
    }
    this.hoveredLineIndexFbo = undefined

    // 3. Destroy Textures
    if (this.linkIndexTexture && !this.linkIndexTexture.destroyed) {
      this.linkIndexTexture.destroy()
    }
    this.linkIndexTexture = undefined
    if (this.hoveredLineIndexTexture && !this.hoveredLineIndexTexture.destroyed) {
      this.hoveredLineIndexTexture.destroy()
    }
    this.hoveredLineIndexTexture = undefined
    if (this.linkStatusTexture && !this.linkStatusTexture.destroyed) {
      this.linkStatusTexture.destroy()
    }
    this.linkStatusTexture = undefined

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.drawLineUniformStore?.destroy()
    this.drawLineUniformStore = undefined
    this.hoveredLineIndexUniformStore?.destroy()
    this.hoveredLineIndexUniformStore = undefined
    this.fillSampledLinksUniformStore?.destroy()
    this.fillSampledLinksUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.pointABuffer && !this.pointABuffer.destroyed) {
      this.pointABuffer.destroy()
    }
    this.pointABuffer = undefined
    if (this.pointBBuffer && !this.pointBBuffer.destroyed) {
      this.pointBBuffer.destroy()
    }
    this.pointBBuffer = undefined
    if (this.sourceColorBuffer && !this.sourceColorBuffer.destroyed) {
      this.sourceColorBuffer.destroy()
    }
    this.sourceColorBuffer = undefined
    if (this.targetColorBuffer && !this.targetColorBuffer.destroyed) {
      this.targetColorBuffer.destroy()
    }
    this.targetColorBuffer = undefined
    this.previousColorData = undefined
    if (this.sourceWidthBuffer && !this.sourceWidthBuffer.destroyed) {
      this.sourceWidthBuffer.destroy()
    }
    this.sourceWidthBuffer = undefined
    if (this.targetWidthBuffer && !this.targetWidthBuffer.destroyed) {
      this.targetWidthBuffer.destroy()
    }
    this.targetWidthBuffer = undefined
    this.previousWidthData = undefined
    if (this.arrowBuffer && !this.arrowBuffer.destroyed) {
      this.arrowBuffer.destroy()
    }
    this.arrowBuffer = undefined
    if (this.linkStyleBuffer && !this.linkStyleBuffer.destroyed) {
      this.linkStyleBuffer.destroy()
    }
    this.linkStyleBuffer = undefined
    if (this.curveLineBuffer && !this.curveLineBuffer.destroyed) {
      this.curveLineBuffer.destroy()
    }
    this.curveLineBuffer = undefined
    if (this.linkIndexBuffer && !this.linkIndexBuffer.destroyed) {
      this.linkIndexBuffer.destroy()
    }
    this.linkIndexBuffer = undefined
    if (this.quadBuffer && !this.quadBuffer.destroyed) {
      this.quadBuffer.destroy()
    }
    this.quadBuffer = undefined
  }

  private createDrawCurveCommand (parameters: RenderPipelineParameters): Model {
    if (!this.drawLineUniformStore) {
      throw new Error('Draw line uniforms must be initialized before creating link draw commands')
    }
    return new Model(this.device, {
      vs: drawLineVert,
      fs: drawLineFrag,
      modules: [conicParametricCurveModule],
      topology: 'triangle-strip',
      vertexCount: this.curveLineGeometry?.length ?? 0,
      attributes: this.getDrawCurveCommandAttributes(),
      bufferLayout: [
        { name: 'position', format: 'float32x2' },
        { name: 'pointA', format: 'float32x2', stepMode: 'instance' },
        { name: 'pointB', format: 'float32x2', stepMode: 'instance' },
        { name: 'sourceColor', format: 'float32x4', stepMode: 'instance' },
        { name: 'targetColor', format: 'float32x4', stepMode: 'instance' },
        { name: 'sourceWidth', format: 'float32', stepMode: 'instance' },
        { name: 'targetWidth', format: 'float32', stepMode: 'instance' },
        { name: 'arrow', format: 'float32', stepMode: 'instance' },
        { name: 'linkIndices', format: 'float32', stepMode: 'instance' },
        { name: 'linkStyle', format: 'float32', stepMode: 'instance' },
      ],
      // The exit-default color channel (variables.ts) reaches the shader as a #define,
      // like in the Points draw command.
      defines: {
        USE_UNIFORM_BUFFERS: true,
        EXIT_DEFAULT_COLOR_CHANNEL: glslFloatLiteral(EXIT_DEFAULT_COLOR_CHANNEL),
      } as unknown as Record<string, boolean>,
      bindings: {
        drawLineUniforms: this.drawLineUniformStore.getManagedUniformBuffer(this.device, 'drawLineUniforms'),
        drawLineFragmentUniforms: this.drawLineUniformStore.getManagedUniformBuffer(this.device, 'drawLineFragmentUniforms'),
      },
      parameters,
    })
  }

  private getDrawCurveCommandAttributes (): DrawCurveCommandAttributes {
    const attributes: DrawCurveCommandAttributes = {}
    if (this.curveLineBuffer) attributes.position = this.curveLineBuffer
    if (this.pointABuffer) attributes.pointA = this.pointABuffer
    if (this.pointBBuffer) attributes.pointB = this.pointBBuffer
    if (this.sourceColorBuffer) attributes.sourceColor = this.sourceColorBuffer
    if (this.targetColorBuffer) attributes.targetColor = this.targetColorBuffer
    if (this.sourceWidthBuffer) attributes.sourceWidth = this.sourceWidthBuffer
    if (this.targetWidthBuffer) attributes.targetWidth = this.targetWidthBuffer
    if (this.arrowBuffer) attributes.arrow = this.arrowBuffer
    if (this.linkIndexBuffer) attributes.linkIndices = this.linkIndexBuffer
    if (this.linkStyleBuffer) attributes.linkStyle = this.linkStyleBuffer
    return attributes
  }

  private setDrawCurveCommandAttributes (attributes: DrawCurveCommandAttributes): void {
    this.drawCurveCommand?.setAttributes(attributes)
    this.drawCurvePickingCommand?.setAttributes(attributes)
  }

  /**
   * Builds the render pipeline parameters for the link draw commands.
   * Visible rendering follows `linkBlending`; picking passes `false`.
   * With `blend` enabled, uses standard source-over alpha blending; with it disabled,
   * fragments overwrite the framebuffer directly (no ROP read-modify-write).
   */
  private getLinkBlendParameters (blend: boolean): RenderPipelineParameters {
    const base: RenderPipelineParameters = {
      cullMode: 'back',
      depthWriteEnabled: false,
      depthCompare: 'always',
    }
    if (!blend) return { ...base, blend: false }
    return {
      ...base,
      blend: true,
      blendColorOperation: 'add',
      blendColorSrcFactor: 'src-alpha',
      blendColorDstFactor: 'one-minus-src-alpha',
      blendAlphaOperation: 'add',
      blendAlphaSrcFactor: 'one',
      blendAlphaDstFactor: 'one-minus-src-alpha',
    }
  }

  // Creates a 1×1 placeholder texture for the linkStatus sampler if none exists.
  // luma.gl silently skips the draw call when any declared sampler is unbound,
  // so this ensures a valid binding is always available. The shader won't sample
  // the placeholder — the isLinkHighlightingActive uniform guards that branch.
  private ensureLinkStatusPlaceholder (): void {
    if (this.linkStatusTexture && !this.linkStatusTexture.destroyed) return
    this.linkStatusTexture = this.device.createTexture({
      width: 1,
      height: 1,
      format: 'rgba32float',
      usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      data: new Float32Array(4).fill(0),
    })
    this.linkStatusTextureSize = 0
  }
}
