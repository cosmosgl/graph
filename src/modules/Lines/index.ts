import { Framebuffer, Buffer, Texture, UniformStore, RenderPass } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import type { Mat4Array } from '@/graph/modules/Store'
import drawLineFrag from '@/graph/modules/Lines/draw-curve-line.frag?raw'
import drawLineVert from '@/graph/modules/Lines/draw-curve-line.vert?raw'
import hoveredLineIndexFrag from '@/graph/modules/Lines/hovered-line-index.frag?raw'
import hoveredLineIndexVert from '@/graph/modules/Lines/hovered-line-index.vert?raw'
import { defaultConfigValues } from '@/graph/variables'
import { getCurveLineGeometry } from '@/graph/modules/Lines/geometry'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import { ensureVec2, ensureVec4 } from '@/graph/modules/Shared/uniform-utils'

export class Lines extends CoreModule {
  public linkIndexFbo: Framebuffer | undefined
  public hoveredLineIndexFbo: Framebuffer | undefined
  private drawCurveCommand: Model | undefined
  private hoveredLineIndexCommand: Model | undefined
  private pointABuffer: Buffer | undefined
  private pointBBuffer: Buffer | undefined
  private colorBuffer: Buffer | undefined
  private widthBuffer: Buffer | undefined
  private arrowBuffer: Buffer | undefined
  private curveLineGeometry: number[][] | undefined
  private curveLineBuffer: Buffer | undefined
  private linkIndexBuffer: Buffer | undefined
  private quadBuffer: Buffer | undefined
  private linkIndexTexture: Texture | undefined
  private hoveredLineIndexTexture: Texture | undefined

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
      hoveredLinkColor: [number, number, number, number];
      hoveredLinkWidthIncrease: number;
    };
    drawLineFragmentUniforms: {
      renderMode: number;
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
    const { device, config, store } = this

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
    this.colorBuffer ||= device.createBuffer({
      data: new Float32Array(linksNumber * 4),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })
    this.widthBuffer ||= device.createBuffer({
      data: new Float32Array(linksNumber),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })
    this.arrowBuffer ||= device.createBuffer({
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
          hoveredLinkColor: 'vec4<f32>',
          hoveredLinkWidthIncrease: 'f32',
        },
        defaultUniforms: {
          transformationMatrix: store.transformationMatrix4x4,
          pointsTextureSize: store.pointsTextureSize,
          widthScale: config.linkWidthScale ?? 1,
          linkArrowsSizeScale: config.linkArrowsSizeScale ?? 1,
          spaceSize: store.adjustedSpaceSize ?? 0,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          linkVisibilityDistanceRange: ensureVec2(config.linkVisibilityDistanceRange, [0, 0]),
          linkVisibilityMinTransparency: config.linkVisibilityMinTransparency ?? 0,
          linkOpacity: config.linkOpacity ?? 1,
          greyoutOpacity: config.linkGreyoutOpacity ?? 1,
          curvedWeight: config.curvedLinkWeight ?? 0,
          curvedLinkControlPointDistance: config.curvedLinkControlPointDistance ?? 0,
          curvedLinkSegments: config.curvedLinks ? config.curvedLinkSegments ?? defaultConfigValues.curvedLinkSegments : 1,
          scaleLinksOnZoom: (config.scaleLinksOnZoom ?? true) ? 1 : 0,
          maxPointSize: store.maxPointSize ?? 100,
          renderMode: 0.0,
          hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
          hoveredLinkColor: ensureVec4(store.hoveredLinkColor, [-1, -1, -1, -1]),
          hoveredLinkWidthIncrease: config.hoveredLinkWidthIncrease ?? 0,
        },
      },
      drawLineFragmentUniforms: {
        uniformTypes: {
          renderMode: 'f32',
        },
        defaultUniforms: {
          renderMode: 0.0,
        },
      },
    })

    this.drawCurveCommand ||= new Model(device, {
      vs: drawLineVert,
      fs: drawLineFrag,
      topology: 'triangle-strip',
      vertexCount: this.curveLineGeometry?.length ?? 0,
      attributes: {
        ...this.curveLineBuffer && { position: this.curveLineBuffer },
        ...this.pointABuffer && { pointA: this.pointABuffer },
        ...this.pointBBuffer && { pointB: this.pointBBuffer },
        ...this.colorBuffer && { color: this.colorBuffer },
        ...this.widthBuffer && { width: this.widthBuffer },
        ...this.arrowBuffer && { arrow: this.arrowBuffer },
        ...this.linkIndexBuffer && { linkIndices: this.linkIndexBuffer },
      },
      bufferLayout: [
        { name: 'position', format: 'float32x2' },
        { name: 'pointA', format: 'float32x2', stepMode: 'instance' },
        { name: 'pointB', format: 'float32x2', stepMode: 'instance' },
        { name: 'color', format: 'float32x4', stepMode: 'instance' },
        { name: 'width', format: 'float32', stepMode: 'instance' },
        { name: 'arrow', format: 'float32', stepMode: 'instance' },
        { name: 'linkIndices', format: 'float32', stepMode: 'instance' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        drawLineUniforms: this.drawLineUniformStore.getManagedUniformBuffer(device, 'drawLineUniforms'),
        drawLineFragmentUniforms: this.drawLineUniformStore.getManagedUniformBuffer(device, 'drawLineFragmentUniforms'),
        // All texture bindings will be set dynamically in draw() method
      },
      /**
         * Blending behavior for link index rendering (renderMode: 1.0 - hover detection):
         *
         * When rendering link indices to the framebuffer, we use full opacity (1.0).
         * This means:
         * - The source color completely overwrites the destination
         * - No blending occurs - it's like drawing with a permanent marker
         * - This preserves the exact index values we need for picking/selection
         */
      parameters: {
        cullMode: 'back',
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })

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
  }

  public draw (renderPass: RenderPass): void {
    const { config, points, store } = this
    if (!points) return
    if (!points.currentPositionTexture || points.currentPositionTexture.destroyed) return
    if (!points.greyoutStatusTexture || points.greyoutStatusTexture.destroyed) return
    if (!this.pointABuffer || !this.pointBBuffer) this.updatePointsBuffer()
    if (!this.colorBuffer) this.updateColor()
    if (!this.widthBuffer) this.updateWidth()
    if (!this.arrowBuffer) this.updateArrow()
    if (!this.curveLineGeometry) this.updateCurveLineGeometry()
    if (!this.drawCurveCommand || !this.drawLineUniformStore) return

    // Update uniforms
    this.drawLineUniformStore.setUniforms({
      drawLineUniforms: {
        transformationMatrix: store.transformationMatrix4x4,
        pointsTextureSize: store.pointsTextureSize,
        widthScale: config.linkWidthScale ?? 1,
        linkArrowsSizeScale: config.linkArrowsSizeScale ?? 1,
        spaceSize: store.adjustedSpaceSize ?? 0,
        screenSize: ensureVec2(store.screenSize, [0, 0]),
        linkVisibilityDistanceRange: ensureVec2(config.linkVisibilityDistanceRange, [0, 0]),
        linkVisibilityMinTransparency: config.linkVisibilityMinTransparency ?? 0,
        linkOpacity: config.linkOpacity ?? 1,
        greyoutOpacity: config.linkGreyoutOpacity ?? 1,
        curvedWeight: config.curvedLinkWeight ?? 0,
        curvedLinkControlPointDistance: config.curvedLinkControlPointDistance ?? 0,
        curvedLinkSegments: config.curvedLinks ? config.curvedLinkSegments ?? defaultConfigValues.curvedLinkSegments : 1,
        scaleLinksOnZoom: (config.scaleLinksOnZoom ?? true) ? 1 : 0,
        maxPointSize: store.maxPointSize ?? 100,
        renderMode: 0.0, // Normal rendering
        hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
        hoveredLinkColor: ensureVec4(store.hoveredLinkColor, [-1, -1, -1, -1]),
        hoveredLinkWidthIncrease: config.hoveredLinkWidthIncrease ?? 0,
      },
      drawLineFragmentUniforms: {
        renderMode: 0.0, // Normal rendering
      },
    })

    // Update texture bindings dynamically
    this.drawCurveCommand.setBindings({
      positionsTexture: points.currentPositionTexture,
      pointGreyoutStatus: points.greyoutStatusTexture,
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
    if (this.drawCurveCommand) {
      this.drawCurveCommand.setAttributes({
        pointA: this.pointABuffer,
        pointB: this.pointBBuffer,
        linkIndices: this.linkIndexBuffer,
      })
    }
  }

  public updateColor (): void {
    const { device, data } = this
    const linksNumber = data.linksNumber ?? 0
    const colorData = data.linkColors ?? new Float32Array(linksNumber * 4).fill(0)

    if (!this.colorBuffer) {
      this.colorBuffer = device.createBuffer({
        data: colorData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      // Check if buffer needs to be resized
      const currentSize = (this.colorBuffer.byteLength ?? 0) / (Float32Array.BYTES_PER_ELEMENT * 4)
      if (currentSize !== linksNumber) {
        if (this.colorBuffer && !this.colorBuffer.destroyed) {
          this.colorBuffer.destroy()
        }
        this.colorBuffer = device.createBuffer({
          data: colorData,
          usage: Buffer.VERTEX | Buffer.COPY_DST,
        })
      } else {
        this.colorBuffer.write(colorData)
      }
    }
    if (this.drawCurveCommand) {
      this.drawCurveCommand.setAttributes({
        color: this.colorBuffer,
      })
    }
  }

  public updateWidth (): void {
    const { device, data } = this
    const linksNumber = data.linksNumber ?? 0
    const widthData = data.linkWidths ?? new Float32Array(linksNumber).fill(0)

    if (!this.widthBuffer) {
      this.widthBuffer = device.createBuffer({
        data: widthData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      // Check if buffer needs to be resized
      const currentSize = (this.widthBuffer.byteLength ?? 0) / Float32Array.BYTES_PER_ELEMENT
      if (currentSize !== linksNumber) {
        if (this.widthBuffer && !this.widthBuffer.destroyed) {
          this.widthBuffer.destroy()
        }
        this.widthBuffer = device.createBuffer({
          data: widthData,
          usage: Buffer.VERTEX | Buffer.COPY_DST,
        })
      } else {
        this.widthBuffer.write(widthData)
      }
    }
    if (this.drawCurveCommand) {
      this.drawCurveCommand.setAttributes({
        width: this.widthBuffer,
      })
    }
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
    if (this.drawCurveCommand) {
      this.drawCurveCommand.setAttributes({
        arrow: this.arrowBuffer,
      })
    }
  }

  public updateCurveLineGeometry (): void {
    const { device, config: { curvedLinks, curvedLinkSegments } } = this
    this.curveLineGeometry = getCurveLineGeometry(curvedLinks ? curvedLinkSegments ?? defaultConfigValues.curvedLinkSegments : 1)

    // Flatten the 2D array to 1D
    const flatGeometry = new Float32Array(this.curveLineGeometry.length * 2)
    for (let i = 0; i < this.curveLineGeometry.length; i++) {
      flatGeometry[i * 2] = this.curveLineGeometry[i]![0]!
      flatGeometry[i * 2 + 1] = this.curveLineGeometry[i]![1]!
    }

    if (!this.curveLineBuffer || this.curveLineBuffer.byteLength !== flatGeometry.byteLength) {
      this.curveLineBuffer?.destroy()
      this.curveLineBuffer = device.createBuffer({
        data: flatGeometry,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.curveLineBuffer.write(flatGeometry)
    }

    // Update vertex count in model if it exists
    if (this.drawCurveCommand) {
      this.drawCurveCommand.setAttributes({
        position: this.curveLineBuffer,
      })
      this.drawCurveCommand.setVertexCount(this.curveLineGeometry.length)
    }
  }

  public findHoveredLine (): void {
    const { config, points, store } = this
    if (!points) return
    if (!points.currentPositionTexture || points.currentPositionTexture.destroyed) return
    if (!points.greyoutStatusTexture || points.greyoutStatusTexture.destroyed) return
    if (!this.data.linksNumber || !this.store.isLinkHoveringEnabled) return
    if (!this.linkIndexFbo || !this.drawCurveCommand || !this.drawLineUniformStore) return
    if (!this.linkIndexTexture || this.linkIndexTexture.destroyed) return

    // Update uniforms for index rendering
    this.drawLineUniformStore.setUniforms({
      drawLineUniforms: {
        transformationMatrix: store.transformationMatrix4x4,
        pointsTextureSize: store.pointsTextureSize,
        widthScale: config.linkWidthScale ?? 1,
        linkArrowsSizeScale: config.linkArrowsSizeScale ?? 1,
        spaceSize: store.adjustedSpaceSize ?? 0,
        screenSize: ensureVec2(store.screenSize, [0, 0]),
        linkVisibilityDistanceRange: ensureVec2(config.linkVisibilityDistanceRange, [0, 0]),
        linkVisibilityMinTransparency: config.linkVisibilityMinTransparency ?? 0,
        linkOpacity: config.linkOpacity ?? 1,
        greyoutOpacity: config.linkGreyoutOpacity ?? 1,
        curvedWeight: config.curvedLinkWeight ?? 0,
        curvedLinkControlPointDistance: config.curvedLinkControlPointDistance ?? 0,
        curvedLinkSegments: config.curvedLinks ? config.curvedLinkSegments ?? defaultConfigValues.curvedLinkSegments : 1,
        scaleLinksOnZoom: (config.scaleLinksOnZoom ?? true) ? 1 : 0,
        maxPointSize: store.maxPointSize ?? 100,
        renderMode: 1.0, // Index rendering for picking
        hoveredLinkIndex: store.hoveredLinkIndex ?? -1,
        hoveredLinkColor: ensureVec4(store.hoveredLinkColor, [-1, -1, -1, -1]),
        hoveredLinkWidthIncrease: config.hoveredLinkWidthIncrease ?? 0,
      },
      drawLineFragmentUniforms: {
        renderMode: 1.0, // Index rendering for picking
      },
    })

    // Update texture bindings dynamically
    this.drawCurveCommand.setBindings({
      positionsTexture: points.currentPositionTexture,
      pointGreyoutStatus: points.greyoutStatusTexture,
    })

    // Update instance count
    this.drawCurveCommand.setInstanceCount(this.data.linksNumber ?? 0)

    // Render to index buffer for picking/hover detection
    const indexPass = this.device.beginRenderPass({
      framebuffer: this.linkIndexFbo,
      // Clear framebuffer to transparent black (luma.gl default would be opaque black)
      clearColor: [0, 0, 0, 0],
    })
    this.drawCurveCommand.draw(indexPass)
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

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST (they destroy _gpuGeometry if exists, and _uniformStore)
    this.drawCurveCommand?.destroy()
    this.drawCurveCommand = undefined
    this.hoveredLineIndexCommand?.destroy()
    this.hoveredLineIndexCommand = undefined

    // 2. Destroy Framebuffers (before textures they reference)
    if (this.linkIndexFbo && !this.linkIndexFbo.destroyed) {
      this.linkIndexFbo.destroy()
    }
    this.linkIndexFbo = undefined
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

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.drawLineUniformStore?.destroy()
    this.drawLineUniformStore = undefined
    this.hoveredLineIndexUniformStore?.destroy()
    this.hoveredLineIndexUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.pointABuffer && !this.pointABuffer.destroyed) {
      this.pointABuffer.destroy()
    }
    this.pointABuffer = undefined
    if (this.pointBBuffer && !this.pointBBuffer.destroyed) {
      this.pointBBuffer.destroy()
    }
    this.pointBBuffer = undefined
    if (this.colorBuffer && !this.colorBuffer.destroyed) {
      this.colorBuffer.destroy()
    }
    this.colorBuffer = undefined
    if (this.widthBuffer && !this.widthBuffer.destroyed) {
      this.widthBuffer.destroy()
    }
    this.widthBuffer = undefined
    if (this.arrowBuffer && !this.arrowBuffer.destroyed) {
      this.arrowBuffer.destroy()
    }
    this.arrowBuffer = undefined
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
}
