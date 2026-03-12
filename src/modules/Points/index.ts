import { Framebuffer, Buffer, Texture, UniformStore, RenderPass } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
// import { scaleLinear } from 'd3-scale'
// import { extent } from 'd3-array'
import { CoreModule } from '@/graph/modules/core-module'
import type { Mat4Array } from '@/graph/modules/Store'
import { defaultConfigValues } from '@/graph/variables'
import drawPointsFrag from '@/graph/modules/Points/draw-points.frag?raw'
import drawPointsVert from '@/graph/modules/Points/draw-points.vert?raw'
import findPointsInRectFrag from '@/graph/modules/Points/find-points-in-rect.frag?raw'
import findPointsInPolygonFrag from '@/graph/modules/Points/find-points-in-polygon.frag?raw'
import drawHighlightedFrag from '@/graph/modules/Points/draw-highlighted.frag?raw'
import drawHighlightedVert from '@/graph/modules/Points/draw-highlighted.vert?raw'
import findHoveredPointFrag from '@/graph/modules/Points/find-hovered-point.frag?raw'
import findHoveredPointVert from '@/graph/modules/Points/find-hovered-point.vert?raw'
import fillGridWithSampledPointsFrag from '@/graph/modules/Points/fill-sampled-points.frag?raw'
import fillGridWithSampledPointsVert from '@/graph/modules/Points/fill-sampled-points.vert?raw'
import updatePositionFrag from '@/graph/modules/Points/update-position.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import trackPositionsFrag from '@/graph/modules/Points/track-positions.frag?raw'
import dragPointFrag from '@/graph/modules/Points/drag-point.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'
import { readPixels } from '@/graph/helper'
import { ensureVec2, ensureVec4 } from '@/graph/modules/Shared/uniform-utils'
import { createAtlasDataFromImageData } from '@/graph/modules/Points/atlas-utils'

export class Points extends CoreModule {
  public currentPositionFbo: Framebuffer | undefined
  public previousPositionFbo: Framebuffer | undefined
  public velocityFbo: Framebuffer | undefined
  public searchFbo: Framebuffer | undefined
  public hoveredFbo: Framebuffer | undefined
  public scaleX: ((x: number) => number) | undefined
  public scaleY: ((y: number) => number) | undefined
  public shouldSkipRescale: boolean | undefined
  public imageAtlasTexture: Texture | undefined
  public imageCount = 0
  // Add texture properties for position data (public for Clusters module access)
  public currentPositionTexture: Texture | undefined
  public previousPositionTexture: Texture | undefined
  public velocityTexture: Texture | undefined
  // Add texture property for greyout status (public for Lines module access)
  public pointStatusTexture: Texture | undefined
  private colorBuffer: Buffer | undefined
  private sizeBuffer: Buffer | undefined
  private shapeBuffer: Buffer | undefined
  private imageIndicesBuffer: Buffer | undefined
  private imageSizesBuffer: Buffer | undefined
  private imageAtlasCoordsTexture: Texture | undefined
  private imageAtlasCoordsTextureSize: number | undefined
  private trackedPositionsFbo: Framebuffer | undefined
  private sampledPointsFbo: Framebuffer | undefined
  private trackedPositions: Map<number, [number, number]> | undefined
  private isPositionsUpToDate = false
  private drawCommand: Model | undefined
  private drawHighlightedCommand: Model | undefined
  private updatePositionCommand: Model | undefined
  private dragPointCommand: Model | undefined
  private findPointsInRectCommand: Model | undefined
  private findPointsInPolygonCommand: Model | undefined
  private findHoveredPointCommand: Model | undefined
  private fillSampledPointsFboCommand: Model | undefined
  private trackPointsCommand: Model | undefined
  // Vertex buffers for quad rendering (Model doesn't destroy them automatically)
  private updatePositionVertexCoordBuffer: Buffer | undefined
  private dragPointVertexCoordBuffer: Buffer | undefined
  private findPointsInRectVertexCoordBuffer: Buffer | undefined
  private findPointsInPolygonVertexCoordBuffer: Buffer | undefined
  private drawHighlightedVertexCoordBuffer: Buffer | undefined
  private trackPointsVertexCoordBuffer: Buffer | undefined
  private trackedIndices: number[] | undefined
  private searchTexture: Texture | undefined
  private pinnedStatusTexture: Texture | undefined
  private sizeTexture: Texture | undefined
  private trackedIndicesTexture: Texture | undefined
  private polygonPathTexture: Texture | undefined
  private polygonPathLength = 0
  private drawPointIndices: Buffer | undefined
  private hoveredPointIndices: Buffer | undefined
  private sampledPointIndices: Buffer | undefined

  // Uniform stores for scalar uniforms
  private updatePositionUniformStore: UniformStore<{
    updatePositionUniforms: {
      friction: number;
      spaceSize: number;
    };
  }> | undefined

  private dragPointUniformStore: UniformStore<{
    dragPointUniforms: {
      mousePos: [number, number];
      index: number;
    };
  }> | undefined

  private drawUniformStore: UniformStore<{
    drawVertexUniforms: {
      ratio: number;
      sizeScale: number;
      pointsTextureSize: number;
      transformationMatrix: Mat4Array;
      spaceSize: number;
      screenSize: [number, number];
      greyoutColor: [number, number, number, number];
      backgroundColor: [number, number, number, number];
      scalePointsOnZoom: number;
      maxPointSize: number;
      isDarkenGreyout: number;
      skipHighlighted: number;
      skipGreyed: number;
      hasImages: number;
      imageCount: number;
      imageAtlasCoordsTextureSize: number;
    };
    drawFragmentUniforms: {
      greyoutOpacity: number;
      pointOpacity: number;
      isDarkenGreyout: number;
      backgroundColor: [number, number, number, number];
      outlineColor: [number, number, number, number];
      outlineWidth: number;
    };
  }> | undefined

  private findPointsInRectUniformStore: UniformStore<{
    findPointsInRectUniforms: {
      spaceSize: number;
      screenSize: [number, number];
      sizeScale: number;
      transformationMatrix: Mat4Array;
      ratio: number;
      rect0: [number, number];
      rect1: [number, number];
      scalePointsOnZoom: number;
      maxPointSize: number;
    };
  }> | undefined

  private findPointsInPolygonUniformStore: UniformStore<{
    findPointsInPolygonUniforms: {
      spaceSize: number;
      screenSize: [number, number];
      transformationMatrix: Mat4Array;
      polygonPathLength: number;
    };
  }> | undefined

  private findHoveredPointUniformStore: UniformStore<{
    findHoveredPointUniforms: {
      ratio: number;
      sizeScale: number;
      pointsTextureSize: number;
      transformationMatrix: Mat4Array;
      spaceSize: number;
      screenSize: [number, number];
      scalePointsOnZoom: number;
      mousePosition: [number, number];
      maxPointSize: number;
      skipHighlighted: number;
      skipGreyed: number;
    };
  }> | undefined

  private fillSampledPointsUniformStore: UniformStore<{
    fillSampledPointsUniforms: {
      pointsTextureSize: number;
      transformationMatrix: Mat4Array;
      spaceSize: number;
      screenSize: [number, number];
    };
  }> | undefined

  private drawHighlightedUniformStore: UniformStore<{
    drawHighlightedUniforms: {
      color: [number, number, number, number];
      width: number;
      pointIndex: number;
      size: number;
      sizeScale: number;
      pointsTextureSize: number;
      transformationMatrix: Mat4Array;
      spaceSize: number;
      screenSize: [number, number];
      scalePointsOnZoom: number; // f32 in shader, not boolean
      maxPointSize: number;
      universalPointOpacity: number;
      greyoutOpacity: number;
      isDarkenGreyout: number; // f32 in shader, not boolean
      backgroundColor: [number, number, number, number];
      greyoutColor: [number, number, number, number];
    };
  }> | undefined

  private trackPointsUniformStore: UniformStore<{
    trackPointsUniforms: {
      pointsTextureSize: number;
    };
  }> | undefined

  public updatePositions (): void {
    const { device, store, data, config: { rescalePositions, enableSimulation } } = this

    const { pointsTextureSize } = store
    if (!pointsTextureSize || !data.pointPositions || data.pointsNumber === undefined) return

    // Create initial state array with exact size needed for RGBA32Float texture
    // Ensure it's a new contiguous buffer (not a view) with the exact size
    const textureDataSize = pointsTextureSize * pointsTextureSize * 4
    const initialState = new Float32Array(textureDataSize)

    const expectedBytes = pointsTextureSize * pointsTextureSize * 4 * 4 // width * height * 4 components * 4 bytes
    const actualBytes = initialState.byteLength
    if (actualBytes !== expectedBytes) {
      console.error('Texture data size mismatch:', {
        pointsTextureSize,
        expectedBytes,
        actualBytes,
        textureDataSize,
        dataLength: initialState.length,
      })
    }

    let shouldRescale = rescalePositions
    // If rescalePositions isn't specified in config and simulation is disabled, default to true
    if (rescalePositions === undefined && !enableSimulation) shouldRescale = true
    // Skip rescaling if `shouldSkipRescale` flag is set (allowing one-time skip of rescaling)
    // Temporary flag is used to skip rescaling when change point positions or adding new points by function `setPointPositions`
    // This flag overrides any other rescaling settings
    if (this.shouldSkipRescale) shouldRescale = false

    if (shouldRescale) {
      this.rescaleInitialNodePositions()
    } else if (!this.shouldSkipRescale) {
      // Only reset scale functions if not temporarily skipping rescale
      this.scaleX = undefined
      this.scaleY = undefined
    }

    // Reset temporary flag
    this.shouldSkipRescale = undefined

    for (let i = 0; i < data.pointsNumber; ++i) {
      initialState[i * 4 + 0] = data.pointPositions[i * 2 + 0] as number
      initialState[i * 4 + 1] = data.pointPositions[i * 2 + 1] as number
      initialState[i * 4 + 2] = i
    }

    // Create currentPositionTexture and framebuffer
    if (!this.currentPositionTexture || this.currentPositionTexture.width !== pointsTextureSize || this.currentPositionTexture.height !== pointsTextureSize) {
      if (this.currentPositionTexture && !this.currentPositionTexture.destroyed) {
        this.currentPositionTexture.destroy()
      }
      if (this.currentPositionFbo && !this.currentPositionFbo.destroyed) {
        this.currentPositionFbo.destroy()
      }
      this.currentPositionTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.currentPositionTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.currentPositionFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.currentPositionTexture],
      })
    } else {
      this.currentPositionTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Create previousPositionTexture and framebuffer
    if (!this.previousPositionTexture ||
        this.previousPositionTexture.width !== pointsTextureSize ||
        this.previousPositionTexture.height !== pointsTextureSize) {
      if (this.previousPositionTexture && !this.previousPositionTexture.destroyed) {
        this.previousPositionTexture.destroy()
      }
      if (this.previousPositionFbo && !this.previousPositionFbo.destroyed) {
        this.previousPositionFbo.destroy()
      }
      this.previousPositionTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.previousPositionTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.previousPositionFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.previousPositionTexture],
      })
    } else {
      this.previousPositionTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    if (this.config.enableSimulation) {
      // Create velocityTexture and framebuffer
      const velocityData = new Float32Array(pointsTextureSize * pointsTextureSize * 4).fill(0)
      if (!this.velocityTexture || this.velocityTexture.width !== pointsTextureSize || this.velocityTexture.height !== pointsTextureSize) {
        if (this.velocityTexture && !this.velocityTexture.destroyed) {
          this.velocityTexture.destroy()
        }
        if (this.velocityFbo && !this.velocityFbo.destroyed) {
          this.velocityFbo.destroy()
        }
        this.velocityTexture = device.createTexture({
          width: pointsTextureSize,
          height: pointsTextureSize,
          format: 'rgba32float',
        })
        this.velocityTexture.copyImageData({
          data: velocityData,
          bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
          mipLevel: 0,
          x: 0,
          y: 0,
        })
        this.velocityFbo = device.createFramebuffer({
          width: pointsTextureSize,
          height: pointsTextureSize,
          colorAttachments: [this.velocityTexture],
        })
      } else {
        this.velocityTexture.copyImageData({
          data: velocityData,
          bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
          mipLevel: 0,
          x: 0,
          y: 0,
        })
      }
    }

    // Create searchTexture and framebuffer
    if (!this.searchTexture || this.searchTexture.width !== pointsTextureSize || this.searchTexture.height !== pointsTextureSize) {
      if (this.searchTexture && !this.searchTexture.destroyed) {
        this.searchTexture.destroy()
      }
      if (this.searchFbo && !this.searchFbo.destroyed) {
        this.searchFbo.destroy()
      }
      this.searchTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.searchTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.searchFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.searchTexture],
      })
    } else {
      this.searchTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Create hoveredFbo (2x2 for hover detection)
    this.hoveredFbo ||= device.createFramebuffer({
      width: 2,
      height: 2,
      colorAttachments: ['rgba32float'],
    })

    // Create buffers
    const indexData = createIndexesForBuffer(store.pointsTextureSize)
    const requiredByteLength = indexData.byteLength

    if (!this.drawPointIndices || this.drawPointIndices.byteLength !== requiredByteLength) {
      if (this.drawPointIndices && !this.drawPointIndices.destroyed) {
        this.drawPointIndices.destroy()
      }
      this.drawPointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.drawPointIndices.write(indexData)
    }

    if (this.drawCommand) {
      this.drawCommand.setAttributes({
        pointIndices: this.drawPointIndices,
      })
    }

    if (!this.hoveredPointIndices || this.hoveredPointIndices.byteLength !== requiredByteLength) {
      if (this.hoveredPointIndices && !this.hoveredPointIndices.destroyed) {
        this.hoveredPointIndices.destroy()
      }
      this.hoveredPointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.hoveredPointIndices.write(indexData)
    }

    if (!this.sampledPointIndices || this.sampledPointIndices.byteLength !== requiredByteLength) {
      if (this.sampledPointIndices && !this.sampledPointIndices.destroyed) {
        this.sampledPointIndices.destroy()
      }
      this.sampledPointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.sampledPointIndices.write(indexData)
    }
    if (this.fillSampledPointsFboCommand) {
      this.fillSampledPointsFboCommand.setAttributes({
        pointIndices: this.sampledPointIndices,
      })
    }

    this.updatePointStatus()
    this.updatePinnedStatus()
    this.updateSampledPointsGrid()

    this.trackPointsByIndices()
  }

  public initPrograms (): void {
    const { device, config, store, data } = this
    // Ensure textures are created before Model initialization
    if (!this.imageAtlasCoordsTexture || !this.imageAtlasTexture) {
      this.createAtlas()
    }
    // Ensure buffers exist before Model creation (Model needs attributes at creation time)
    if (!this.colorBuffer) this.updateColor()
    if (!this.sizeBuffer) this.updateSize()
    if (!this.shapeBuffer) this.updateShape()
    if (!this.imageIndicesBuffer) this.updateImageIndices()
    if (!this.imageSizesBuffer) this.updateImageSizes()
    if (!this.pointStatusTexture) this.updatePointStatus()
    if (config.enableSimulation) {
      // Create vertex buffer for quad
      this.updatePositionVertexCoordBuffer ||= device.createBuffer({
        data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      })

      // Create UniformStore for updatePosition uniforms
      this.updatePositionUniformStore ||= new UniformStore({
        updatePositionUniforms: {
          uniformTypes: {
            // Order MUST match shader declaration order (std140 layout)
            friction: 'f32',
            spaceSize: 'f32',
          },
          defaultUniforms: {
            friction: config.simulationFriction ?? defaultConfigValues.simulationFriction,
            spaceSize: store.adjustedSpaceSize,
          },
        },
      })

      this.updatePositionCommand ||= new Model(device, {
        fs: updatePositionFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.updatePositionVertexCoordBuffer,
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
          updatePositionUniforms: this.updatePositionUniformStore.getManagedUniformBuffer(device, 'updatePositionUniforms'),
          // All texture bindings will be set dynamically in updatePosition() method
        },
      })
    }

    // Create vertex buffer for quad
    this.dragPointVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    // Create UniformStore for dragPoint uniforms
    this.dragPointUniformStore ||= new UniformStore({
      dragPointUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          mousePos: 'vec2<f32>',
          index: 'f32',
        },
        defaultUniforms: {
          mousePos: ensureVec2(store.mousePosition, [0, 0]),
          index: store.hoveredPoint?.index ?? -1,
        },
      },
    })

    this.dragPointCommand ||= new Model(device, {
      fs: dragPointFrag,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.dragPointVertexCoordBuffer,
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
        dragPointUniforms: this.dragPointUniformStore.getManagedUniformBuffer(device, 'dragPointUniforms'),
        // All texture bindings will be set dynamically in drag() method
      },
    })

    // Create UniformStore for draw uniforms
    this.drawUniformStore ||= new UniformStore({
      drawVertexUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          ratio: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          pointsTextureSize: 'f32',
          sizeScale: 'f32',
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
          greyoutColor: 'vec4<f32>',
          backgroundColor: 'vec4<f32>',
          scalePointsOnZoom: 'f32',
          maxPointSize: 'f32',
          isDarkenGreyout: 'f32',
          skipHighlighted: 'f32',
          skipGreyed: 'f32',
          hasImages: 'f32',
          imageCount: 'f32',
          imageAtlasCoordsTextureSize: 'f32',
        },
        defaultUniforms: {
          // Order MUST match uniformTypes and shader declaration
          ratio: config.pixelRatio ?? defaultConfigValues.pixelRatio,
          transformationMatrix: ((): Mat4Array => {
            const t = store.transform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
            return [
              t[0], t[1], t[2], 0,
              t[3], t[4], t[5], 0,
              t[6], t[7], t[8], 0,
              0, 0, 0, 1,
            ]
          })(),
          pointsTextureSize: store.pointsTextureSize ?? 0,
          sizeScale: config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          greyoutColor: ensureVec4(store.greyoutPointColor, [0, 0, 0, 1]),
          backgroundColor: ensureVec4(store.backgroundColor, [0, 0, 0, 1]),
          scalePointsOnZoom: (config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0, // Convert boolean to float
          maxPointSize: store.maxPointSize,
          isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
          skipHighlighted: 0, // Default to 0 (false)
          skipGreyed: 0, // Default to 0 (false)
          hasImages: (this.imageCount > 0) ? 1 : 0, // Convert boolean to float
          imageCount: this.imageCount,
          imageAtlasCoordsTextureSize: this.imageAtlasCoordsTextureSize ?? 0,
        },
      },
      drawFragmentUniforms: {
        uniformTypes: {
          greyoutOpacity: 'f32',
          pointOpacity: 'f32',
          isDarkenGreyout: 'f32',
          backgroundColor: 'vec4<f32>',
          outlineColor: 'vec4<f32>',
          outlineWidth: 'f32',
        },
        defaultUniforms: {
          // -1 is a sentinel value for the shader: when greyoutOpacity is -1, the shader skips opacity override (i.e. "not set")
          greyoutOpacity: config.pointGreyoutOpacity ?? -1,
          pointOpacity: config.pointOpacity ?? defaultConfigValues.pointOpacity,
          isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
          backgroundColor: ensureVec4(store.backgroundColor, [0, 0, 0, 1]),
          outlineColor: ensureVec4(store.outlinedPointRingColor, [1, 1, 1, 1]),
          outlineWidth: 0.9,
        },
      },
    })

    this.drawCommand ||= new Model(device, {
      fs: drawPointsFrag,
      vs: drawPointsVert,
      topology: 'point-list',
      vertexCount: data.pointsNumber ?? 0,
      attributes: {
        ...(this.drawPointIndices && { pointIndices: this.drawPointIndices }),
        ...(this.sizeBuffer && { size: this.sizeBuffer }),
        ...(this.colorBuffer && { color: this.colorBuffer }),
        ...(this.shapeBuffer && { shape: this.shapeBuffer }),
        ...(this.imageIndicesBuffer && { imageIndex: this.imageIndicesBuffer }),
        ...(this.imageSizesBuffer && { imageSize: this.imageSizesBuffer }),
      },
      bufferLayout: [
        { name: 'pointIndices', format: 'float32x2' },
        { name: 'size', format: 'float32' },
        { name: 'color', format: 'float32x4' },
        { name: 'shape', format: 'float32' },
        { name: 'imageIndex', format: 'float32' },
        { name: 'imageSize', format: 'float32' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        drawVertexUniforms: this.drawUniformStore.getManagedUniformBuffer(device, 'drawVertexUniforms'),
        drawFragmentUniforms: this.drawUniformStore.getManagedUniformBuffer(device, 'drawFragmentUniforms'),
        // All texture bindings will be set dynamically in draw() method
      },
      parameters: {
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

    // Create vertex buffer for quad
    this.findPointsInRectVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    // Create UniformStore for findPointsInRect uniforms
    this.findPointsInRectUniformStore ||= new UniformStore({
      findPointsInRectUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          sizeScale: 'f32',
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
          ratio: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          rect0: 'vec2<f32>',
          rect1: 'vec2<f32>',
          scalePointsOnZoom: 'f32',
          maxPointSize: 'f32',
        },
        defaultUniforms: {
          sizeScale: config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          ratio: config.pixelRatio ?? defaultConfigValues.pixelRatio,
          transformationMatrix: store.transformationMatrix4x4,
          rect0: ensureVec2(store.searchArea?.[0], [0, 0]),
          rect1: ensureVec2(store.searchArea?.[1], [0, 0]),
          scalePointsOnZoom: (config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0,
          maxPointSize: store.maxPointSize,
        },
      },
    })

    this.findPointsInRectCommand ||= new Model(device, {
      fs: findPointsInRectFrag,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.findPointsInRectVertexCoordBuffer,
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
        findPointsInRectUniforms: this.findPointsInRectUniformStore.getManagedUniformBuffer(device, 'findPointsInRectUniforms'),
        // All texture bindings will be set dynamically in findPointsInRect() method
      },
    })

    // Create vertex buffer for quad
    this.findPointsInPolygonVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    // Create UniformStore for findPointsInPolygon uniforms
    this.findPointsInPolygonUniformStore ||= new UniformStore({
      findPointsInPolygonUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
          transformationMatrix: 'mat4x4<f32>',
          polygonPathLength: 'f32',
        },
        defaultUniforms: {
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          transformationMatrix: store.transformationMatrix4x4,
          polygonPathLength: this.polygonPathLength,
        },
      },
    })

    this.findPointsInPolygonCommand ||= new Model(device, {
      fs: findPointsInPolygonFrag,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.findPointsInPolygonVertexCoordBuffer,
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
        findPointsInPolygonUniforms: this.findPointsInPolygonUniformStore
          .getManagedUniformBuffer(device, 'findPointsInPolygonUniforms'),
        // All texture bindings will be set dynamically in findPointsInPolygon() method
      },
    })

    // Create UniformStore for findHoveredPoint uniforms
    this.findHoveredPointUniformStore ||= new UniformStore({
      findHoveredPointUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          sizeScale: 'f32',
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
          ratio: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          mousePosition: 'vec2<f32>',
          scalePointsOnZoom: 'f32',
          maxPointSize: 'f32',
          skipHighlighted: 'f32',
          skipGreyed: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          sizeScale: config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          ratio: config.pixelRatio ?? defaultConfigValues.pixelRatio,
          transformationMatrix: store.transformationMatrix4x4,
          mousePosition: ensureVec2(store.screenMousePosition, [0, 0]),
          scalePointsOnZoom: (config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0,
          maxPointSize: store.maxPointSize,
          skipHighlighted: 0,
          skipGreyed: 0,
        },
      },
    })

    this.findHoveredPointCommand ||= new Model(device, {
      fs: findHoveredPointFrag,
      vs: findHoveredPointVert,
      topology: 'point-list',
      vertexCount: data.pointsNumber ?? 0,
      attributes: {
        ...(this.hoveredPointIndices && { pointIndices: this.hoveredPointIndices }),
        ...(this.sizeBuffer && { size: this.sizeBuffer }),
      },
      bufferLayout: [
        { name: 'pointIndices', format: 'float32x2' },
        { name: 'size', format: 'float32' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        findHoveredPointUniforms: this.findHoveredPointUniformStore.getManagedUniformBuffer(device, 'findHoveredPointUniforms'),
        // All texture bindings will be set dynamically in findHoveredPoint() method
      },
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
        blend: false, // Disable blending - we want to overwrite, not blend
      },
    })

    // Create UniformStore for fillSampledPoints uniforms
    this.fillSampledPointsUniformStore ||= new UniformStore({
      fillSampledPointsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          transformationMatrix: store.transformationMatrix4x4,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
        },
      },
    })

    this.fillSampledPointsFboCommand ||= new Model(device, {
      fs: fillGridWithSampledPointsFrag,
      vs: fillGridWithSampledPointsVert,
      topology: 'point-list',
      vertexCount: data.pointsNumber ?? 0,
      attributes: {
        ...(this.sampledPointIndices && { pointIndices: this.sampledPointIndices }),
      },
      bufferLayout: [
        { name: 'pointIndices', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        fillSampledPointsUniforms: this.fillSampledPointsUniformStore.getManagedUniformBuffer(device, 'fillSampledPointsUniforms'),
        // All texture bindings will be set dynamically in getSampledPointPositionsMap() and getSampledPoints() methods
      },
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })

    this.drawHighlightedVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.drawHighlightedUniformStore ||= new UniformStore({
      drawHighlightedUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          // Vertex shader uniforms:
          size: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          pointsTextureSize: 'f32',
          sizeScale: 'f32',
          spaceSize: 'f32',
          screenSize: 'vec2<f32>',
          scalePointsOnZoom: 'f32',
          pointIndex: 'f32',
          maxPointSize: 'f32',
          color: 'vec4<f32>',
          universalPointOpacity: 'f32',
          greyoutOpacity: 'f32',
          isDarkenGreyout: 'f32',
          backgroundColor: 'vec4<f32>',
          greyoutColor: 'vec4<f32>',
          // Fragment shader uniforms (width is in same block):
          width: 'f32',
        },
        defaultUniforms: {
          size: 1,
          transformationMatrix: store.transformationMatrix4x4,
          pointsTextureSize: store.pointsTextureSize ?? 0,
          sizeScale: config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          scalePointsOnZoom: (config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0,
          pointIndex: -1,
          maxPointSize: store.maxPointSize,
          color: [0, 0, 0, 1],
          universalPointOpacity: config.pointOpacity ?? defaultConfigValues.pointOpacity,
          // -1 is a sentinel value for the shader: when greyoutOpacity is -1, the shader skips opacity override (i.e. "not set")
          greyoutOpacity: config.pointGreyoutOpacity ?? -1,
          isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0,
          backgroundColor: ensureVec4(store.backgroundColor, [0, 0, 0, 1]),
          greyoutColor: ensureVec4(store.greyoutPointColor, [0, 0, 0, 1]),
          width: 0.85,
        },
      },
    })

    this.drawHighlightedCommand ||= new Model(device, {
      fs: drawHighlightedFrag,
      vs: drawHighlightedVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.drawHighlightedVertexCoordBuffer,
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
        drawHighlightedUniforms: this.drawHighlightedUniformStore.getManagedUniformBuffer(device, 'drawHighlightedUniforms'),
        // All texture bindings will be set dynamically in draw() method
      },
      parameters: {
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

    // Create vertex buffer for quad
    this.trackPointsVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    // Create UniformStore for trackPoints uniforms
    this.trackPointsUniformStore ||= new UniformStore({
      trackPointsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
        },
      },
    })

    this.trackPointsCommand ||= new Model(device, {
      fs: trackPositionsFrag,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.trackPointsVertexCoordBuffer,
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
        trackPointsUniforms: this.trackPointsUniformStore.getManagedUniformBuffer(device, 'trackPointsUniforms'),
        // All texture bindings will be set dynamically in trackPoints() method
      },
    })
  }

  public updateColor (): void {
    const { device, store: { pointsTextureSize }, data } = this
    if (!pointsTextureSize) return

    const colorData = data.pointColors as Float32Array
    const requiredByteLength = colorData.byteLength

    if (!this.colorBuffer || this.colorBuffer.byteLength !== requiredByteLength) {
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
    if (this.drawCommand) {
      this.drawCommand.setAttributes({
        color: this.colorBuffer,
      })
    }
  }

  public updatePointStatus (): void {
    const { device, config, store: { pointsTextureSize } } = this
    if (!pointsTextureSize) return

    const { highlightedPointIndices, outlinedPointIndices } = config
    const hasHighlighting = highlightedPointIndices !== undefined
    const hasOutlining = outlinedPointIndices !== undefined

    // Point status texture channels:
    // R = greyout (0 = highlighted/normal, 1 = greyed)
    // G = outlined (0 = no ring, 1 = draw ring)
    const state = new Float32Array(pointsTextureSize * pointsTextureSize * 4)

    const maxIndex = pointsTextureSize * pointsTextureSize

    if (hasHighlighting) {
      // Fill R channel with 1 (all greyed by default)
      for (let i = 0; i < state.length; i += 4) state[i] = 1
      // Clear R channel for highlighted points
      for (const idx of highlightedPointIndices) {
        if (idx >= 0 && idx < maxIndex) state[idx * 4] = 0
      }
    }

    if (hasOutlining) {
      // Set G channel for outlined points
      for (const idx of outlinedPointIndices) {
        if (idx >= 0 && idx < maxIndex) state[idx * 4 + 1] = 1
      }
    }

    const copyData = {
      data: state,
      bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    }

    if (!this.pointStatusTexture || this.pointStatusTexture.width !== pointsTextureSize || this.pointStatusTexture.height !== pointsTextureSize) {
      if (this.pointStatusTexture && !this.pointStatusTexture.destroyed) {
        this.pointStatusTexture.destroy()
      }
      this.pointStatusTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.pointStatusTexture.copyImageData(copyData)
    } else {
      this.pointStatusTexture.copyImageData(copyData)
    }
  }

  public updatePinnedStatus (): void {
    const { device, store: { pointsTextureSize }, data } = this
    if (!pointsTextureSize) return

    // Pinned status: 0 - not pinned, 1 - pinned
    const initialState = new Float32Array(pointsTextureSize * pointsTextureSize * 4).fill(0)

    if (data.inputPinnedPoints && data.pointsNumber !== undefined) {
      for (const pinnedIndex of data.inputPinnedPoints) {
        if (pinnedIndex >= 0 && pinnedIndex < data.pointsNumber) {
          initialState[pinnedIndex * 4] = 1
        }
      }
    }

    if (!this.pinnedStatusTexture || this.pinnedStatusTexture.width !== pointsTextureSize || this.pinnedStatusTexture.height !== pointsTextureSize) {
      if (this.pinnedStatusTexture && !this.pinnedStatusTexture.destroyed) {
        this.pinnedStatusTexture.destroy()
      }
      this.pinnedStatusTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.pinnedStatusTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    } else {
      this.pinnedStatusTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }
  }

  public updateSize (): void {
    const { device, store: { pointsTextureSize }, data } = this
    if (!pointsTextureSize || data.pointsNumber === undefined || data.pointSizes === undefined) return

    const sizeData = data.pointSizes
    const requiredByteLength = sizeData.byteLength

    if (!this.sizeBuffer || this.sizeBuffer.byteLength !== requiredByteLength) {
      if (this.sizeBuffer && !this.sizeBuffer.destroyed) {
        this.sizeBuffer.destroy()
      }
      this.sizeBuffer = device.createBuffer({
        data: sizeData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.sizeBuffer.write(sizeData)
    }
    if (this.drawCommand) {
      this.drawCommand.setAttributes({
        size: this.sizeBuffer,
      })
    }

    const initialState = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
    for (let i = 0; i < data.pointsNumber; i++) {
      initialState[i * 4] = data.pointSizes[i] as number
    }

    if (!this.sizeTexture || this.sizeTexture.width !== pointsTextureSize || this.sizeTexture.height !== pointsTextureSize) {
      if (this.sizeTexture && !this.sizeTexture.destroyed) {
        this.sizeTexture.destroy()
      }
      this.sizeTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.sizeTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    } else {
      this.sizeTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }
  }

  public updateShape (): void {
    const { device, data } = this
    if (data.pointsNumber === undefined || data.pointShapes === undefined) return

    const shapeData = data.pointShapes
    const requiredByteLength = shapeData.byteLength

    if (!this.shapeBuffer || this.shapeBuffer.byteLength !== requiredByteLength) {
      if (this.shapeBuffer && !this.shapeBuffer.destroyed) {
        this.shapeBuffer.destroy()
      }
      this.shapeBuffer = device.createBuffer({
        data: shapeData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.shapeBuffer.write(shapeData)
    }
    if (this.drawCommand) {
      this.drawCommand.setAttributes({
        shape: this.shapeBuffer,
      })
    }
  }

  public updateImageIndices (): void {
    const { device, data } = this
    if (data.pointsNumber === undefined || data.pointImageIndices === undefined) return

    const imageIndicesData = data.pointImageIndices
    const requiredByteLength = imageIndicesData.byteLength

    if (!this.imageIndicesBuffer || this.imageIndicesBuffer.byteLength !== requiredByteLength) {
      if (this.imageIndicesBuffer && !this.imageIndicesBuffer.destroyed) {
        this.imageIndicesBuffer.destroy()
      }
      this.imageIndicesBuffer = device.createBuffer({
        data: imageIndicesData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.imageIndicesBuffer.write(imageIndicesData)
    }
    if (this.drawCommand) {
      this.drawCommand.setAttributes({
        imageIndex: this.imageIndicesBuffer,
      })
    }
  }

  public updateImageSizes (): void {
    const { device, data } = this
    if (data.pointsNumber === undefined || data.pointImageSizes === undefined) return

    const imageSizesData = data.pointImageSizes
    const requiredByteLength = imageSizesData.byteLength

    if (!this.imageSizesBuffer || this.imageSizesBuffer.byteLength !== requiredByteLength) {
      if (this.imageSizesBuffer && !this.imageSizesBuffer.destroyed) {
        this.imageSizesBuffer.destroy()
      }
      this.imageSizesBuffer = device.createBuffer({
        data: imageSizesData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.imageSizesBuffer.write(imageSizesData)
    }
    if (this.drawCommand) {
      this.drawCommand.setAttributes({
        imageSize: this.imageSizesBuffer,
      })
    }
  }

  public createAtlas (): void {
    const { device, data, store } = this

    if (!data.inputImageData?.length) {
      this.imageCount = 0
      this.imageAtlasCoordsTextureSize = 0
      // Create dummy textures so bindings are always available
      this.imageAtlasCoordsTexture ||= device.createTexture({
        data: new Float32Array(4).fill(0),
        width: 1,
        height: 1,
        format: 'rgba32float',
      })

      this.imageAtlasTexture ||= device.createTexture({
        data: new Uint8Array(4).fill(0),
        width: 1,
        height: 1,
        format: 'rgba8unorm',
      })

      return
    }

    const atlasResult = createAtlasDataFromImageData(data.inputImageData, store.webglMaxTextureSize)
    if (!atlasResult) {
      console.warn('Failed to create atlas from image data')
      return
    }

    this.imageCount = data.inputImageData.length
    const { atlasData, atlasSize, atlasCoords, atlasCoordsSize } = atlasResult
    this.imageAtlasCoordsTextureSize = atlasCoordsSize

    // Recreate atlas texture to avoid row-stride/format issues
    if (this.imageAtlasTexture && !this.imageAtlasTexture.destroyed) {
      this.imageAtlasTexture.destroy()
    }
    this.imageAtlasTexture = device.createTexture({
      width: atlasSize,
      height: atlasSize,
      format: 'rgba8unorm',
    })
    this.imageAtlasTexture.copyImageData({
      data: atlasData,
      bytesPerRow: getBytesPerRow('rgba8unorm', atlasSize),
      rowsPerImage: atlasSize,
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    // Recreate coords texture
    if (this.imageAtlasCoordsTexture && !this.imageAtlasCoordsTexture.destroyed) {
      this.imageAtlasCoordsTexture.destroy()
    }
    this.imageAtlasCoordsTexture = device.createTexture({
      width: atlasCoordsSize,
      height: atlasCoordsSize,
      format: 'rgba32float',
    })
    this.imageAtlasCoordsTexture.copyImageData({
      data: atlasCoords,
      bytesPerRow: getBytesPerRow('rgba32float', atlasCoordsSize),
      rowsPerImage: atlasCoordsSize,
      mipLevel: 0,
      x: 0,
      y: 0,
    })
  }

  public updateSampledPointsGrid (): void {
    const { store: { screenSize }, config: { pointSamplingDistance }, device } = this
    let dist = pointSamplingDistance ?? Math.min(...screenSize) / 2
    if (dist === 0) dist = defaultConfigValues.pointSamplingDistance
    const w = Math.ceil(screenSize[0] / dist)
    const h = Math.ceil(screenSize[1] / dist)
    if (w === 0 || h === 0) return

    if (!this.sampledPointsFbo || this.sampledPointsFbo.width !== w || this.sampledPointsFbo.height !== h) {
      if (this.sampledPointsFbo && !this.sampledPointsFbo.destroyed) {
        this.sampledPointsFbo.destroy()
      }
      this.sampledPointsFbo = device.createFramebuffer({
        width: w,
        height: h,
        colorAttachments: ['rgba32float'],
      })
    }
  }

  public trackPoints (): void {
    if (!this.trackedIndices?.length || !this.trackPointsCommand || !this.trackPointsUniformStore ||
        !this.trackedPositionsFbo || this.trackedPositionsFbo.destroyed) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
    if (!this.trackedIndicesTexture || this.trackedIndicesTexture.destroyed) return

    this.trackPointsUniformStore.setUniforms({
      trackPointsUniforms: {
        pointsTextureSize: this.store.pointsTextureSize ?? 0,
      },
    })

    // Update texture bindings dynamically
    this.trackPointsCommand.setBindings({
      positionsTexture: this.currentPositionTexture,
      trackedIndices: this.trackedIndicesTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.trackedPositionsFbo,
    })
    this.trackPointsCommand.draw(renderPass)
    renderPass.end()
  }

  public draw (renderPass: RenderPass): void {
    const { data, config, store } = this
    if (!this.colorBuffer) this.updateColor()
    if (!this.sizeBuffer) this.updateSize()
    if (!this.shapeBuffer) this.updateShape()
    if (!this.imageIndicesBuffer) this.updateImageIndices()
    if (!this.imageSizesBuffer) this.updateImageSizes()

    if (!this.drawCommand || !this.drawUniformStore) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
    if (!this.pointStatusTexture || this.pointStatusTexture.destroyed) return
    if (!this.imageAtlasTexture || !this.imageAtlasCoordsTexture) {
      this.createAtlas()
      if (!this.imageAtlasTexture || !this.imageAtlasCoordsTexture) return
    }
    if (this.imageAtlasTexture.destroyed || this.imageAtlasCoordsTexture.destroyed) return

    // Check if we have points to draw
    if (!data.pointsNumber || data.pointsNumber === 0) {
      return
    }

    // Verify canvas is sized (screenSize must be non-zero to avoid division by zero in shader)
    if (!store.screenSize || store.screenSize[0] === 0 || store.screenSize[1] === 0) {
      return
    }

    // Update vertex count dynamically
    this.drawCommand.setVertexCount(data.pointsNumber)

    // Base uniforms that don't change between layers
    // Convert booleans to floats (1.0 or 0.0) since uniform type is 'f32'
    const baseVertexUniforms = {
      ratio: config.pixelRatio ?? defaultConfigValues.pixelRatio,
      transformationMatrix: store.transformationMatrix4x4,
      pointsTextureSize: store.pointsTextureSize ?? 0,
      sizeScale: config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
      spaceSize: store.adjustedSpaceSize,
      screenSize: ensureVec2(store.screenSize, [0, 0]),
      greyoutColor: ensureVec4(store.greyoutPointColor, [-1, -1, -1, -1]),
      backgroundColor: ensureVec4(store.backgroundColor, [0, 0, 0, 1]),
      scalePointsOnZoom: (config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0, // Convert boolean to float
      maxPointSize: store.maxPointSize,
      isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
      hasImages: (this.imageCount > 0) ? 1 : 0, // Convert boolean to float
      imageCount: this.imageCount,
      imageAtlasCoordsTextureSize: this.imageAtlasCoordsTextureSize ?? 0,
    }

    const baseFragmentUniforms = {
      // -1 is a sentinel value for the shader: when greyoutOpacity is -1, the shader skips opacity override (i.e. "not set")
      greyoutOpacity: config.pointGreyoutOpacity ?? -1,
      pointOpacity: config.pointOpacity ?? defaultConfigValues.pointOpacity,
      isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
      backgroundColor: ensureVec4(store.backgroundColor, [0, 0, 0, 1]),
      outlineColor: ensureVec4(store.outlinedPointRingColor, [1, 1, 1, 1]),
      outlineWidth: 0.9,
    }

    const hasHighlighting = config.highlightedPointIndices !== undefined

    // Render in layers: greyed points first (behind), then highlighted points (in front)
    if (hasHighlighting) {
      // First draw greyed points (they will appear behind)
      this.drawUniformStore.setUniforms({
        drawVertexUniforms: {
          ...baseVertexUniforms,
          skipHighlighted: 1,
          skipGreyed: 0,
        },
        drawFragmentUniforms: baseFragmentUniforms,
      })

      this.drawCommand.setBindings({
        positionsTexture: this.currentPositionTexture,
        pointStatus: this.pointStatusTexture,
        imageAtlasTexture: this.imageAtlasTexture,
        imageAtlasCoords: this.imageAtlasCoordsTexture,
      })

      this.drawCommand.draw(renderPass)

      // Then draw highlighted points (they will appear in front)
      this.drawUniformStore.setUniforms({
        drawVertexUniforms: {
          ...baseVertexUniforms,
          skipHighlighted: 0,
          skipGreyed: 1,
        },
        drawFragmentUniforms: baseFragmentUniforms,
      })

      this.drawCommand.setBindings({
        positionsTexture: this.currentPositionTexture,
        pointStatus: this.pointStatusTexture,
        imageAtlasTexture: this.imageAtlasTexture,
        imageAtlasCoords: this.imageAtlasCoordsTexture,
      })

      this.drawCommand.draw(renderPass)
    } else {
      // If no highlighting, draw all points
      this.drawUniformStore.setUniforms({
        drawVertexUniforms: {
          ...baseVertexUniforms,
          skipHighlighted: 0,
          skipGreyed: 0,
        },
        drawFragmentUniforms: baseFragmentUniforms,
      })

      this.drawCommand.setBindings({
        positionsTexture: this.currentPositionTexture,
        pointStatus: this.pointStatusTexture,
        imageAtlasTexture: this.imageAtlasTexture,
        imageAtlasCoords: this.imageAtlasCoordsTexture,
      })

      this.drawCommand.draw(renderPass)
    }

    // Draw highlighted point rings if enabled
    if (config.renderHoveredPointRing && store.hoveredPoint && this.drawHighlightedCommand && this.drawHighlightedUniformStore) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
      if (!this.pointStatusTexture || this.pointStatusTexture.destroyed) return
      const pointSize = data.pointSizes?.[store.hoveredPoint.index] ?? 1
      this.drawHighlightedUniformStore.setUniforms({
        drawHighlightedUniforms: {
          size: pointSize,
          transformationMatrix: store.transformationMatrix4x4,
          pointsTextureSize: store.pointsTextureSize ?? 0,
          sizeScale: config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          scalePointsOnZoom: (config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0,
          pointIndex: store.hoveredPoint.index,
          maxPointSize: store.maxPointSize,
          color: ensureVec4(store.hoveredPointRingColor, [0, 0, 0, 1]),
          universalPointOpacity: config.pointOpacity ?? defaultConfigValues.pointOpacity,
          // -1 is a sentinel value for the shader: when greyoutOpacity is -1, the shader skips opacity override (i.e. "not set")
          greyoutOpacity: config.pointGreyoutOpacity ?? -1,
          isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0,
          backgroundColor: ensureVec4(store.backgroundColor, [0, 0, 0, 1]),
          greyoutColor: ensureVec4(store.greyoutPointColor, [0, 0, 0, 1]),
          width: 0.85,
        },
      })
      // Update texture bindings dynamically
      this.drawHighlightedCommand.setBindings({
        positionsTexture: this.currentPositionTexture,
        pointStatus: this.pointStatusTexture,
      })
      this.drawHighlightedCommand.draw(renderPass)
    }

    if (store.focusedPoint && this.drawHighlightedCommand && this.drawHighlightedUniformStore) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
      if (!this.pointStatusTexture || this.pointStatusTexture.destroyed) return
      const pointSize = data.pointSizes?.[store.focusedPoint.index] ?? 1
      this.drawHighlightedUniformStore.setUniforms({
        drawHighlightedUniforms: {
          size: pointSize,
          transformationMatrix: store.transformationMatrix4x4,
          pointsTextureSize: store.pointsTextureSize ?? 0,
          sizeScale: config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
          spaceSize: store.adjustedSpaceSize,
          screenSize: ensureVec2(store.screenSize, [0, 0]),
          scalePointsOnZoom: (config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0,
          pointIndex: store.focusedPoint.index,
          maxPointSize: store.maxPointSize,
          color: ensureVec4(store.focusedPointRingColor, [0, 0, 0, 1]),
          universalPointOpacity: config.pointOpacity ?? defaultConfigValues.pointOpacity,
          // -1 is a sentinel value for the shader: when greyoutOpacity is -1, the shader skips opacity override (i.e. "not set")
          greyoutOpacity: config.pointGreyoutOpacity ?? -1,
          isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0,
          backgroundColor: ensureVec4(store.backgroundColor, [0, 0, 0, 1]),
          greyoutColor: ensureVec4(store.greyoutPointColor, [0, 0, 0, 1]),
          width: 0.85,
        },
      })
      // Update texture bindings dynamically
      this.drawHighlightedCommand.setBindings({
        positionsTexture: this.currentPositionTexture,
        pointStatus: this.pointStatusTexture,
      })
      this.drawHighlightedCommand.draw(renderPass)
    }
  }

  public updatePosition (): void {
    if (!this.updatePositionCommand || !this.updatePositionUniformStore || !this.currentPositionFbo || this.currentPositionFbo.destroyed) return
    if (!this.previousPositionTexture || this.previousPositionTexture.destroyed) return
    if (!this.velocityTexture || this.velocityTexture.destroyed) return
    if (!this.pinnedStatusTexture || this.pinnedStatusTexture.destroyed) return

    this.updatePositionUniformStore.setUniforms({
      updatePositionUniforms: {
        friction: this.config.simulationFriction ?? defaultConfigValues.simulationFriction,
        spaceSize: this.store.adjustedSpaceSize,
      },
    })

    // Update texture bindings dynamically
    this.updatePositionCommand.setBindings({
      positionsTexture: this.previousPositionTexture,
      velocity: this.velocityTexture,
      pinnedStatusTexture: this.pinnedStatusTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.currentPositionFbo,
    })
    this.updatePositionCommand.draw(renderPass)
    renderPass.end()

    this.swapFbo()
    // Invalidate tracked positions cache since positions have changed
    this.isPositionsUpToDate = false
  }

  public drag (): void {
    if (!this.dragPointCommand || !this.dragPointUniformStore || !this.currentPositionFbo || this.currentPositionFbo.destroyed) return
    if (!this.previousPositionTexture || this.previousPositionTexture.destroyed) return

    this.dragPointUniformStore.setUniforms({
      dragPointUniforms: {
        mousePos: ensureVec2(this.store.mousePosition, [0, 0]),
        index: this.store.hoveredPoint?.index ?? -1,
      },
    })

    // Update texture bindings dynamically
    this.dragPointCommand.setBindings({
      positionsTexture: this.previousPositionTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.currentPositionFbo,
    })
    this.dragPointCommand.draw(renderPass)
    renderPass.end()

    this.swapFbo()
    // Invalidate tracked positions cache since positions have changed
    this.isPositionsUpToDate = false
  }

  public findPointsInRect (): void {
    if (!this.findPointsInRectCommand || !this.findPointsInRectUniformStore || !this.searchFbo || this.searchFbo.destroyed) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
    if (!this.sizeTexture || this.sizeTexture.destroyed) return

    this.findPointsInRectUniformStore.setUniforms({
      findPointsInRectUniforms: {
        spaceSize: this.store.adjustedSpaceSize,
        screenSize: ensureVec2(this.store.screenSize, [0, 0]),
        sizeScale: this.config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
        transformationMatrix: this.store.transformationMatrix4x4,
        ratio: this.config.pixelRatio ?? defaultConfigValues.pixelRatio,
        rect0: ensureVec2(this.store.searchArea?.[0], [0, 0]),
        rect1: ensureVec2(this.store.searchArea?.[1], [0, 0]),
        scalePointsOnZoom: (this.config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0, // Convert boolean to number
        maxPointSize: this.store.maxPointSize,
      },
    })

    // Update texture bindings dynamically
    this.findPointsInRectCommand.setBindings({
      positionsTexture: this.currentPositionTexture,
      pointSize: this.sizeTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.searchFbo,
    })
    this.findPointsInRectCommand.draw(renderPass)
    renderPass.end()
  }

  public findPointsInPolygon (): void {
    if (!this.findPointsInPolygonCommand || !this.findPointsInPolygonUniformStore || !this.searchFbo || this.searchFbo.destroyed) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
    if (!this.polygonPathTexture || this.polygonPathTexture.destroyed) return

    this.findPointsInPolygonUniformStore.setUniforms({
      findPointsInPolygonUniforms: {
        spaceSize: this.store.adjustedSpaceSize,
        screenSize: ensureVec2(this.store.screenSize, [0, 0]),
        transformationMatrix: this.store.transformationMatrix4x4,
        polygonPathLength: this.polygonPathLength,
      },
    })

    // Update texture bindings dynamically
    this.findPointsInPolygonCommand.setBindings({
      positionsTexture: this.currentPositionTexture,
      polygonPathTexture: this.polygonPathTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.searchFbo,
    })
    this.findPointsInPolygonCommand.draw(renderPass)
    renderPass.end()
  }

  public updatePolygonPath (polygonPath: [number, number][]): void {
    const { device } = this
    this.polygonPathLength = polygonPath.length

    if (polygonPath.length === 0) {
      if (this.polygonPathTexture && !this.polygonPathTexture.destroyed) {
        this.polygonPathTexture.destroy()
      }
      this.polygonPathTexture = undefined
      return
    }

    // Calculate texture size (square texture)
    const textureSize = Math.ceil(Math.sqrt(polygonPath.length))
    const textureData = new Float32Array(textureSize * textureSize * 4)

    // Fill texture with polygon path points
    for (const [i, point] of polygonPath.entries()) {
      const [x, y] = point
      textureData[i * 4] = x
      textureData[i * 4 + 1] = y
      textureData[i * 4 + 2] = 0 // unused
      textureData[i * 4 + 3] = 0 // unused
    }

    if (!this.polygonPathTexture || this.polygonPathTexture.width !== textureSize || this.polygonPathTexture.height !== textureSize) {
      if (this.polygonPathTexture && !this.polygonPathTexture.destroyed) {
        this.polygonPathTexture.destroy()
      }
      this.polygonPathTexture = device.createTexture({
        width: textureSize,
        height: textureSize,
        format: 'rgba32float',
      })
      this.polygonPathTexture.copyImageData({
        data: textureData,
        bytesPerRow: getBytesPerRow('rgba32float', textureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    } else {
      this.polygonPathTexture.copyImageData({
        data: textureData,
        bytesPerRow: getBytesPerRow('rgba32float', textureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }
  }

  public findHoveredPoint (): void {
    if (!this.hoveredFbo || this.hoveredFbo.destroyed) return

    if (!this.findHoveredPointCommand || !this.findHoveredPointUniformStore) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
    if (!this.pointStatusTexture) this.updatePointStatus()
    if (!this.pointStatusTexture || this.pointStatusTexture.destroyed) return

    this.findHoveredPointCommand.setVertexCount(this.data.pointsNumber ?? 0)

    this.findHoveredPointCommand.setAttributes({
      ...(this.hoveredPointIndices && { pointIndices: this.hoveredPointIndices }),
      ...(this.sizeBuffer && { size: this.sizeBuffer }),
    })

    const baseUniforms = {
      ratio: this.config.pixelRatio ?? defaultConfigValues.pixelRatio,
      sizeScale: this.config.pointSizeScale ?? defaultConfigValues.pointSizeScale,
      pointsTextureSize: this.store.pointsTextureSize ?? 0,
      transformationMatrix: this.store.transformationMatrix4x4,
      spaceSize: this.store.adjustedSpaceSize,
      screenSize: ensureVec2(this.store.screenSize, [0, 0]),
      scalePointsOnZoom: (this.config.scalePointsOnZoom ?? defaultConfigValues.scalePointsOnZoom) ? 1 : 0,
      mousePosition: ensureVec2(this.store.screenMousePosition, [0, 0]),
      maxPointSize: this.store.maxPointSize,
    }

    const bindings = {
      positionsTexture: this.currentPositionTexture,
      pointStatus: this.pointStatusTexture,
    }

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.hoveredFbo,
      clearColor: [0, 0, 0, 0],
    })

    const hasHighlighting = this.config.highlightedPointIndices !== undefined
    if (hasHighlighting) {
      // Same two-pass order as drawing: greyed first, then highlighted (top-most wins)
      this.findHoveredPointUniformStore.setUniforms({
        findHoveredPointUniforms: {
          ...baseUniforms,
          skipHighlighted: 1,
          skipGreyed: 0,
        },
      })
      this.findHoveredPointCommand.setBindings(bindings)
      this.findHoveredPointCommand.draw(renderPass)

      this.findHoveredPointUniformStore.setUniforms({
        findHoveredPointUniforms: {
          ...baseUniforms,
          skipHighlighted: 0,
          skipGreyed: 1,
        },
      })
      this.findHoveredPointCommand.setBindings(bindings)
      this.findHoveredPointCommand.draw(renderPass)
    } else {
      this.findHoveredPointUniformStore.setUniforms({
        findHoveredPointUniforms: {
          ...baseUniforms,
          skipHighlighted: 0,
          skipGreyed: 0,
        },
      })
      this.findHoveredPointCommand.setBindings(bindings)
      this.findHoveredPointCommand.draw(renderPass)
    }

    renderPass.end()
  }

  public trackPointsByIndices (indices?: number[] | undefined): void {
    const { store: { pointsTextureSize }, device } = this
    this.trackedIndices = indices

    // Clear cache when changing tracked indices
    this.trackedPositions = undefined
    this.isPositionsUpToDate = false

    if (!indices?.length || !pointsTextureSize) return
    const textureSize = Math.ceil(Math.sqrt(indices.length))

    const initialState = new Float32Array(textureSize * textureSize * 4).fill(-1)
    for (const [i, sortedIndex] of indices.entries()) {
      if (sortedIndex !== undefined) {
        initialState[i * 4] = sortedIndex % pointsTextureSize
        initialState[i * 4 + 1] = Math.floor(sortedIndex / pointsTextureSize)
        initialState[i * 4 + 2] = 0
        initialState[i * 4 + 3] = 0
      }
    }

    if (!this.trackedIndicesTexture || this.trackedIndicesTexture.width !== textureSize || this.trackedIndicesTexture.height !== textureSize) {
      if (this.trackedIndicesTexture && !this.trackedIndicesTexture.destroyed) {
        this.trackedIndicesTexture.destroy()
      }
      this.trackedIndicesTexture = device.createTexture({
        width: textureSize,
        height: textureSize,
        format: 'rgba32float',
      })
      this.trackedIndicesTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', textureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    } else {
      this.trackedIndicesTexture.copyImageData({
        data: initialState,
        bytesPerRow: getBytesPerRow('rgba32float', textureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    if (!this.trackedPositionsFbo || this.trackedPositionsFbo.width !== textureSize || this.trackedPositionsFbo.height !== textureSize) {
      if (this.trackedPositionsFbo && !this.trackedPositionsFbo.destroyed) {
        this.trackedPositionsFbo.destroy()
      }
      this.trackedPositionsFbo = device.createFramebuffer({
        width: textureSize,
        height: textureSize,
        colorAttachments: ['rgba32float'],
      })
    }

    this.trackPoints()
  }

  /**
   * Get current X and Y coordinates of the tracked points.
   *
   * When the simulation is disabled or stopped, this method returns a cached
   * result to avoid expensive GPU-to-CPU memory transfers (`readPixels`).
   *
   * @returns A ReadonlyMap where keys are point indices and values are [x, y] coordinates.
   */
  public getTrackedPositionsMap (): ReadonlyMap<number, [number, number]> {
    if (!this.trackedIndices) return new Map()

    const { config: { enableSimulation }, store: { isSimulationRunning } } = this

    // Use cached positions when simulation is inactive and cache is valid
    if ((!enableSimulation || !isSimulationRunning) &&
        this.isPositionsUpToDate &&
        this.trackedPositions) {
      return this.trackedPositions
    }

    if (!this.trackedPositionsFbo || this.trackedPositionsFbo.destroyed) return new Map()

    const pixels = readPixels(this.device, this.trackedPositionsFbo as Framebuffer)

    const tracked = new Map<number, [number, number]>()
    for (let i = 0; i < pixels.length / 4; i += 1) {
      const x = pixels[i * 4]
      const y = pixels[i * 4 + 1]
      const index = this.trackedIndices[i]
      if (x !== undefined && y !== undefined && index !== undefined) {
        tracked.set(index, [x, y])
      }
    }

    // If simulation is inactive, cache the result for next time
    if (!enableSimulation || !isSimulationRunning) {
      this.trackedPositions = tracked
      this.isPositionsUpToDate = true
    }

    return tracked
  }

  public getSampledPointPositionsMap (): Map<number, [number, number]> {
    const positions = new Map<number, [number, number]>()
    if (!this.sampledPointsFbo || this.sampledPointsFbo.destroyed) return positions

    // Fill sampled points FBO
    if (this.fillSampledPointsFboCommand && this.fillSampledPointsUniformStore && this.sampledPointsFbo) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return positions
      // Update vertex count dynamically
      this.fillSampledPointsFboCommand.setVertexCount(this.data.pointsNumber ?? 0)

      this.fillSampledPointsUniformStore.setUniforms({
        fillSampledPointsUniforms: {
          pointsTextureSize: this.store.pointsTextureSize ?? 0,
          transformationMatrix: this.store.transformationMatrix4x4,
          spaceSize: this.store.adjustedSpaceSize,
          screenSize: ensureVec2(this.store.screenSize, [0, 0]),
        },
      })

      // Update texture bindings dynamically
      this.fillSampledPointsFboCommand.setBindings({
        positionsTexture: this.currentPositionTexture,
      })

      const fillPass = this.device.beginRenderPass({
        framebuffer: this.sampledPointsFbo,
        clearColor: [0, 0, 0, 0],
      })
      this.fillSampledPointsFboCommand.draw(fillPass)
      fillPass.end()
    }

    const pixels = readPixels(this.device, this.sampledPointsFbo as Framebuffer)
    for (let i = 0; i < pixels.length / 4; i++) {
      const index = pixels[i * 4]
      const isNotEmpty = !!pixels[i * 4 + 1]
      const x = pixels[i * 4 + 2]
      const y = pixels[i * 4 + 3]

      if (isNotEmpty && index !== undefined && x !== undefined && y !== undefined) {
        positions.set(index, [x, y])
      }
    }
    return positions
  }

  public getSampledPoints (): { indices: number[]; positions: number[] } {
    const indices: number[] = []
    const positions: number[] = []
    if (!this.sampledPointsFbo || this.sampledPointsFbo.destroyed) return { indices, positions }

    // Fill sampled points FBO
    if (this.fillSampledPointsFboCommand && this.fillSampledPointsUniformStore && this.sampledPointsFbo) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return { indices, positions }
      // Update vertex count dynamically
      this.fillSampledPointsFboCommand.setVertexCount(this.data.pointsNumber ?? 0)

      this.fillSampledPointsUniformStore.setUniforms({
        fillSampledPointsUniforms: {
          pointsTextureSize: this.store.pointsTextureSize ?? 0,
          transformationMatrix: this.store.transformationMatrix4x4,
          spaceSize: this.store.adjustedSpaceSize,
          screenSize: ensureVec2(this.store.screenSize, [0, 0]),
        },
      })

      // Update texture bindings dynamically
      this.fillSampledPointsFboCommand.setBindings({
        positionsTexture: this.currentPositionTexture,
      })

      const fillPass = this.device.beginRenderPass({
        framebuffer: this.sampledPointsFbo,
        clearColor: [0, 0, 0, 0],
      })
      this.fillSampledPointsFboCommand.draw(fillPass)
      fillPass.end()
    }

    const pixels = readPixels(this.device, this.sampledPointsFbo as Framebuffer)

    for (let i = 0; i < pixels.length / 4; i++) {
      const index = pixels[i * 4]
      const isNotEmpty = !!pixels[i * 4 + 1]
      const x = pixels[i * 4 + 2]
      const y = pixels[i * 4 + 3]

      if (isNotEmpty && index !== undefined && x !== undefined && y !== undefined) {
        indices.push(index)
        positions.push(x, y)
      }
    }

    return { indices, positions }
  }

  public getTrackedPositionsArray (): number[] {
    const positions: number[] = []
    if (!this.trackedIndices) return positions
    if (!this.trackedPositionsFbo || this.trackedPositionsFbo.destroyed) return positions
    positions.length = this.trackedIndices.length * 2
    const pixels = readPixels(this.device, this.trackedPositionsFbo as Framebuffer)
    for (let i = 0; i < pixels.length / 4; i += 1) {
      const x = pixels[i * 4]
      const y = pixels[i * 4 + 1]
      const index = this.trackedIndices[i]
      if (x !== undefined && y !== undefined && index !== undefined) {
        positions[i * 2] = x
        positions[i * 2 + 1] = y
      }
    }
    return positions
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   * */
  public destroy (): void {
    // 1. Destroy Models FIRST (they destroy _gpuGeometry if exists, and _uniformStore)
    this.drawCommand?.destroy()
    this.drawCommand = undefined
    this.drawHighlightedCommand?.destroy()
    this.drawHighlightedCommand = undefined
    this.updatePositionCommand?.destroy()
    this.updatePositionCommand = undefined
    this.dragPointCommand?.destroy()
    this.dragPointCommand = undefined
    this.findPointsInRectCommand?.destroy()
    this.findPointsInRectCommand = undefined
    this.findPointsInPolygonCommand?.destroy()
    this.findPointsInPolygonCommand = undefined
    this.findHoveredPointCommand?.destroy()
    this.findHoveredPointCommand = undefined
    this.fillSampledPointsFboCommand?.destroy()
    this.fillSampledPointsFboCommand = undefined
    this.trackPointsCommand?.destroy()
    this.trackPointsCommand = undefined

    // 2. Destroy Framebuffers (before textures they reference)
    if (this.currentPositionFbo && !this.currentPositionFbo.destroyed) {
      this.currentPositionFbo.destroy()
    }
    this.currentPositionFbo = undefined
    if (this.previousPositionFbo && !this.previousPositionFbo.destroyed) {
      this.previousPositionFbo.destroy()
    }
    this.previousPositionFbo = undefined
    if (this.velocityFbo && !this.velocityFbo.destroyed) {
      this.velocityFbo.destroy()
    }
    this.velocityFbo = undefined
    if (this.searchFbo && !this.searchFbo.destroyed) {
      this.searchFbo.destroy()
    }
    this.searchFbo = undefined
    if (this.hoveredFbo && !this.hoveredFbo.destroyed) {
      this.hoveredFbo.destroy()
    }
    this.hoveredFbo = undefined
    if (this.trackedPositionsFbo && !this.trackedPositionsFbo.destroyed) {
      this.trackedPositionsFbo.destroy()
    }
    this.trackedPositionsFbo = undefined
    if (this.sampledPointsFbo && !this.sampledPointsFbo.destroyed) {
      this.sampledPointsFbo.destroy()
    }
    this.sampledPointsFbo = undefined

    // 3. Destroy Textures
    if (this.currentPositionTexture && !this.currentPositionTexture.destroyed) {
      this.currentPositionTexture.destroy()
    }
    this.currentPositionTexture = undefined
    if (this.previousPositionTexture && !this.previousPositionTexture.destroyed) {
      this.previousPositionTexture.destroy()
    }
    this.previousPositionTexture = undefined
    if (this.velocityTexture && !this.velocityTexture.destroyed) {
      this.velocityTexture.destroy()
    }
    this.velocityTexture = undefined
    if (this.searchTexture && !this.searchTexture.destroyed) {
      this.searchTexture.destroy()
    }
    this.searchTexture = undefined
    if (this.pointStatusTexture && !this.pointStatusTexture.destroyed) {
      this.pointStatusTexture.destroy()
    }
    this.pointStatusTexture = undefined
    if (this.sizeTexture && !this.sizeTexture.destroyed) {
      this.sizeTexture.destroy()
    }
    this.sizeTexture = undefined
    if (this.trackedIndicesTexture && !this.trackedIndicesTexture.destroyed) {
      this.trackedIndicesTexture.destroy()
    }
    this.trackedIndicesTexture = undefined
    if (this.polygonPathTexture && !this.polygonPathTexture.destroyed) {
      this.polygonPathTexture.destroy()
    }
    this.polygonPathTexture = undefined
    if (this.imageAtlasTexture && !this.imageAtlasTexture.destroyed) {
      this.imageAtlasTexture.destroy()
    }
    this.imageAtlasTexture = undefined
    if (this.imageAtlasCoordsTexture && !this.imageAtlasCoordsTexture.destroyed) {
      this.imageAtlasCoordsTexture.destroy()
    }
    this.imageAtlasCoordsTexture = undefined
    if (this.pinnedStatusTexture && !this.pinnedStatusTexture.destroyed) {
      this.pinnedStatusTexture.destroy()
    }
    this.pinnedStatusTexture = undefined

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.updatePositionUniformStore?.destroy()
    this.updatePositionUniformStore = undefined
    this.dragPointUniformStore?.destroy()
    this.dragPointUniformStore = undefined
    this.drawUniformStore?.destroy()
    this.drawUniformStore = undefined
    this.findPointsInRectUniformStore?.destroy()
    this.findPointsInRectUniformStore = undefined
    this.findPointsInPolygonUniformStore?.destroy()
    this.findPointsInPolygonUniformStore = undefined
    this.findHoveredPointUniformStore?.destroy()
    this.findHoveredPointUniformStore = undefined
    this.fillSampledPointsUniformStore?.destroy()
    this.fillSampledPointsUniformStore = undefined
    this.drawHighlightedUniformStore?.destroy()
    this.drawHighlightedUniformStore = undefined
    this.trackPointsUniformStore?.destroy()
    this.trackPointsUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.colorBuffer && !this.colorBuffer.destroyed) {
      this.colorBuffer.destroy()
    }
    this.colorBuffer = undefined
    if (this.sizeBuffer && !this.sizeBuffer.destroyed) {
      this.sizeBuffer.destroy()
    }
    this.sizeBuffer = undefined
    if (this.shapeBuffer && !this.shapeBuffer.destroyed) {
      this.shapeBuffer.destroy()
    }
    this.shapeBuffer = undefined
    if (this.imageIndicesBuffer && !this.imageIndicesBuffer.destroyed) {
      this.imageIndicesBuffer.destroy()
    }
    this.imageIndicesBuffer = undefined
    if (this.imageSizesBuffer && !this.imageSizesBuffer.destroyed) {
      this.imageSizesBuffer.destroy()
    }
    this.imageSizesBuffer = undefined
    if (this.drawPointIndices && !this.drawPointIndices.destroyed) {
      this.drawPointIndices.destroy()
    }
    this.drawPointIndices = undefined
    if (this.hoveredPointIndices && !this.hoveredPointIndices.destroyed) {
      this.hoveredPointIndices.destroy()
    }
    this.hoveredPointIndices = undefined
    if (this.sampledPointIndices && !this.sampledPointIndices.destroyed) {
      this.sampledPointIndices.destroy()
    }
    this.sampledPointIndices = undefined
    if (this.updatePositionVertexCoordBuffer && !this.updatePositionVertexCoordBuffer.destroyed) {
      this.updatePositionVertexCoordBuffer.destroy()
    }
    this.updatePositionVertexCoordBuffer = undefined
    if (this.dragPointVertexCoordBuffer && !this.dragPointVertexCoordBuffer.destroyed) {
      this.dragPointVertexCoordBuffer.destroy()
    }
    this.dragPointVertexCoordBuffer = undefined
    if (this.findPointsInRectVertexCoordBuffer && !this.findPointsInRectVertexCoordBuffer.destroyed) {
      this.findPointsInRectVertexCoordBuffer.destroy()
    }
    this.findPointsInRectVertexCoordBuffer = undefined
    if (this.findPointsInPolygonVertexCoordBuffer && !this.findPointsInPolygonVertexCoordBuffer.destroyed) {
      this.findPointsInPolygonVertexCoordBuffer.destroy()
    }
    this.findPointsInPolygonVertexCoordBuffer = undefined
    if (this.drawHighlightedVertexCoordBuffer && !this.drawHighlightedVertexCoordBuffer.destroyed) {
      this.drawHighlightedVertexCoordBuffer.destroy()
    }
    this.drawHighlightedVertexCoordBuffer = undefined
    if (this.trackPointsVertexCoordBuffer && !this.trackPointsVertexCoordBuffer.destroyed) {
      this.trackPointsVertexCoordBuffer.destroy()
    }
    this.trackPointsVertexCoordBuffer = undefined
  }

  private swapFbo (): void {
    // Swap textures and framebuffers
    // Safety check: ensure resources exist and aren't destroyed before swapping
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed ||
        !this.previousPositionTexture || this.previousPositionTexture.destroyed ||
        !this.currentPositionFbo || this.currentPositionFbo.destroyed ||
        !this.previousPositionFbo || this.previousPositionFbo.destroyed) {
      return
    }
    const tempTexture = this.previousPositionTexture
    const tempFbo = this.previousPositionFbo
    this.previousPositionTexture = this.currentPositionTexture
    this.previousPositionFbo = this.currentPositionFbo
    this.currentPositionTexture = tempTexture
    this.currentPositionFbo = tempFbo
  }

  private rescaleInitialNodePositions (): void {
    const { config: { spaceSize } } = this
    if (!this.data.pointPositions || !spaceSize) return

    const points = this.data.pointPositions
    const pointsNumber = points.length / 2
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i] as number
      const y = points[i + 1] as number
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    const w = maxX - minX
    const h = maxY - minY
    const range = Math.max(w, h)

    // Do not rescale if the range is greater than the space size (no need to)
    if (range > spaceSize) {
      this.scaleX = undefined
      this.scaleY = undefined
      return
    }

    // Density threshold - points per pixel ratio (0.001 = 0.1%)
    const densityThreshold = spaceSize * spaceSize * 0.001
    // Calculate effective space size based on point density
    const effectiveSpaceSize = pointsNumber > densityThreshold
    // For dense datasets: scale up based on point count, minimum 120% of space
      ? spaceSize * Math.max(1.2, Math.sqrt(pointsNumber) / spaceSize)
    // For sparse datasets: use 10% of space to cluster points closer
      : spaceSize * 0.1

    // Calculate uniform scale factor to fit data within effective space
    const scaleFactor = effectiveSpaceSize / range
    // Shift to center the scaled data within the full [0, spaceSize] space
    const centerOffset = (spaceSize - effectiveSpaceSize) / 2
    // Pad the shorter axis so both axes are centered within the square bounding box
    const offsetX = ((range - w) / 2) * scaleFactor + centerOffset
    const offsetY = ((range - h) / 2) * scaleFactor + centerOffset

    this.scaleX = (x: number): number => (x - minX) * scaleFactor + offsetX
    this.scaleY = (y: number): number => (y - minY) * scaleFactor + offsetY

    // Apply scaling to point positions
    for (let i = 0; i < pointsNumber; i++) {
      this.data.pointPositions[i * 2] = this.scaleX(points[i * 2] as number)
      this.data.pointPositions[i * 2 + 1] = this.scaleY(points[i * 2 + 1] as number)
    }
  }
}
