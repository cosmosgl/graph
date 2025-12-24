import { Framebuffer, Buffer, Texture, UniformStore, RenderPass } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
// import { scaleLinear } from 'd3-scale'
// import { extent } from 'd3-array'
import { CoreModule } from '@/graph/modules/core-module'
import { defaultConfigValues } from '@/graph/variables'
import drawPointsFrag from '@/graph/modules/Points/draw-points.frag?raw'
import drawPointsVert from '@/graph/modules/Points/draw-points.vert?raw'
import findPointsOnAreaSelectionFrag from '@/graph/modules/Points/find-points-on-area-selection.frag?raw'
import findPointsOnPolygonSelectionFrag from '@/graph/modules/Points/find-points-on-polygon-selection.frag?raw'
import drawHighlightedFrag from '@/graph/modules/Points/draw-highlighted.frag?raw'
import drawHighlightedVert from '@/graph/modules/Points/draw-highlighted.vert?raw'
import findHoveredPointFrag from '@/graph/modules/Points/find-hovered-point.frag?raw'
import findHoveredPointVert from '@/graph/modules/Points/find-hovered-point.vert?raw'
import fillGridWithSampledPointsFrag from '@/graph/modules/Points/fill-sampled-points.frag?raw'
import fillGridWithSampledPointsVert from '@/graph/modules/Points/fill-sampled-points.vert?raw'
import updatePositionFrag from '@/graph/modules/Points/update-position.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import trackPositionsFrag from '@/graph/modules/Points/track-positions.frag?raw'
import dragPointFrag from '@/graph/modules/Points/drag-point.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'
import clearFrag from '@/graph/modules/Shared/clear.frag?raw'
import { readPixels } from '@/graph/helper'
import { createAtlasDataFromImageData } from '@/graph/modules/Points/atlas-utils'

export class Points extends CoreModule {
  public currentPositionFbo: Framebuffer | undefined
  public previousPositionFbo: Framebuffer | undefined
  public velocityFbo: Framebuffer | undefined
  public selectedFbo: Framebuffer | undefined
  public hoveredFbo: Framebuffer | undefined
  public greyoutStatusFbo: Framebuffer | undefined
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
  public greyoutStatusTexture: Texture | undefined
  private colorBuffer: Buffer | undefined
  private sizeFbo: Framebuffer | undefined
  private sizeBuffer: Buffer | undefined
  private shapeBuffer: Buffer | undefined
  private imageIndicesBuffer: Buffer | undefined
  private imageSizesBuffer: Buffer | undefined
  private imageAtlasCoordsTexture: Texture | undefined
  private imageAtlasCoordsTextureSize: number | undefined
  private trackedIndicesFbo: Framebuffer | undefined
  private trackedPositionsFbo: Framebuffer | undefined
  private sampledPointsFbo: Framebuffer | undefined
  private trackedPositions: Map<number, [number, number]> | undefined
  private isPositionsUpToDate = false
  private drawCommand: Model | undefined
  private drawHighlightedCommand: Model | undefined
  private updatePositionCommand: Model | undefined
  private dragPointCommand: Model | undefined
  private findPointsOnAreaSelectionCommand: Model | undefined
  private findPointsOnPolygonSelectionCommand: Model | undefined
  private findHoveredPointCommand: Model | undefined
  private clearHoveredFboCommand: Model | undefined
  private clearSampledPointsFboCommand: Model | undefined
  private fillSampledPointsFboCommand: Model | undefined
  private trackPointsCommand: Model | undefined
  // Vertex buffers for quad rendering (Model doesn't destroy them automatically)
  private updatePositionVertexCoordBuffer: Buffer | undefined
  private dragPointVertexCoordBuffer: Buffer | undefined
  private findPointsOnAreaSelectionVertexCoordBuffer: Buffer | undefined
  private findPointsOnPolygonSelectionVertexCoordBuffer: Buffer | undefined
  private clearHoveredFboVertexCoordBuffer: Buffer | undefined
  private clearSampledPointsFboVertexCoordBuffer: Buffer | undefined
  private drawHighlightedVertexCoordBuffer: Buffer | undefined
  private trackPointsVertexCoordBuffer: Buffer | undefined
  private trackedIndices: number[] | undefined
  private selectedTexture: Texture | undefined
  private greyoutStatusTexture: Texture | undefined
  private pinnedStatusTexture: regl.Texture2D | undefined
  private pinnedStatusFbo: regl.Framebuffer2D | undefined
  private sizeTexture: Texture | undefined
  private trackedIndicesTexture: Texture | undefined
  private polygonPathTexture: Texture | undefined
  private polygonPathFbo: Framebuffer | undefined
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
      transformationMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
      spaceSize: number;
      screenSize: [number, number];
      greyoutColor: [number, number, number, number];
      backgroundColor: [number, number, number, number];
      scalePointsOnZoom: number;
      maxPointSize: number;
      isDarkenGreyout: number;
      skipSelected: number;
      skipUnselected: number;
      hasImages: number;
      imageCount: number;
      imageAtlasCoordsTextureSize: number;
    };
    drawFragmentUniforms: {
      greyoutOpacity: number;
      pointOpacity: number;
      isDarkenGreyout: number;
      backgroundColor: [number, number, number, number];
    };
  }> | undefined

  private findPointsOnAreaSelectionUniformStore: UniformStore<{
    findPointsOnAreaSelectionUniforms: {
      spaceSize: number;
      screenSize: [number, number];
      sizeScale: number;
      transformationMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
      ratio: number;
      selection0: [number, number];
      selection1: [number, number];
      scalePointsOnZoom: number;
      maxPointSize: number;
    };
  }> | undefined

  private findPointsOnPolygonSelectionUniformStore: UniformStore<{
    findPointsOnPolygonSelectionUniforms: {
      spaceSize: number;
      screenSize: [number, number];
      transformationMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
      polygonPathLength: number;
    };
  }> | undefined

  private findHoveredPointUniformStore: UniformStore<{
    findHoveredPointUniforms: {
      ratio: number;
      sizeScale: number;
      pointsTextureSize: number;
      transformationMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
      spaceSize: number;
      screenSize: [number, number];
      scalePointsOnZoom: number;
      mousePosition: [number, number];
      maxPointSize: number;
    };
  }> | undefined

  private fillSampledPointsUniformStore: UniformStore<{
    fillSampledPointsUniforms: {
      pointsTextureSize: number;
      transformationMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
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
      transformationMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
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
      if (this.currentPositionTexture) {
        this.currentPositionTexture.destroy()
      }
      if (this.currentPositionFbo) {
        this.currentPositionFbo.destroy()
      }
      this.currentPositionTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.currentPositionTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
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
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Create previousPositionTexture and framebuffer
    if (!this.previousPositionTexture ||
        this.previousPositionTexture.width !== pointsTextureSize ||
        this.previousPositionTexture.height !== pointsTextureSize) {
      if (this.previousPositionTexture) {
        this.previousPositionTexture.destroy()
      }
      if (this.previousPositionFbo) {
        this.previousPositionFbo.destroy()
      }
      this.previousPositionTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.previousPositionTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
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
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    if (this.config.enableSimulation) {
      // Create velocityTexture and framebuffer
      const velocityData = new Float32Array(pointsTextureSize * pointsTextureSize * 4).fill(0)
      if (!this.velocityTexture || this.velocityTexture.width !== pointsTextureSize || this.velocityTexture.height !== pointsTextureSize) {
        if (this.velocityTexture) {
          this.velocityTexture.destroy()
        }
        if (this.velocityFbo) {
          this.velocityFbo.destroy()
        }
        this.velocityTexture = device.createTexture({
          width: pointsTextureSize,
          height: pointsTextureSize,
          format: 'rgba32float',
        })
        this.velocityTexture.copyImageData({
          data: velocityData,
          bytesPerRow: pointsTextureSize,
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
          bytesPerRow: pointsTextureSize,
          mipLevel: 0,
          x: 0,
          y: 0,
        })
      }
    }

    // Create selectedTexture and framebuffer
    if (!this.selectedTexture || this.selectedTexture.width !== pointsTextureSize || this.selectedTexture.height !== pointsTextureSize) {
      if (this.selectedTexture) {
        this.selectedTexture.destroy()
      }
      if (this.selectedFbo) {
        this.selectedFbo.destroy()
      }
      this.selectedTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.selectedTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.selectedFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.selectedTexture],
      })
    } else {
      this.selectedTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Create hoveredFbo (2x2 for hover detection)
    if (!this.hoveredFbo) {
      this.hoveredFbo = device.createFramebuffer({
        width: 2,
        height: 2,
        colorAttachments: ['rgba32float'],
      })
    }

    // Create buffers
    const indexData = createIndexesForBuffer(store.pointsTextureSize)
    const requiredByteLength = indexData.byteLength

    if (!this.drawPointIndices || this.drawPointIndices.byteLength !== requiredByteLength) {
      this.drawPointIndices?.destroy()
      this.drawPointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.drawPointIndices.write(indexData)
    }

    if (!this.hoveredPointIndices || this.hoveredPointIndices.byteLength !== requiredByteLength) {
      this.hoveredPointIndices?.destroy()
      this.hoveredPointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.hoveredPointIndices.write(indexData)
    }

    if (!this.sampledPointIndices || this.sampledPointIndices.byteLength !== requiredByteLength) {
      this.sampledPointIndices?.destroy()
      this.sampledPointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.sampledPointIndices.write(indexData)
    }

    this.updateGreyoutStatus()
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
    if (!this.greyoutStatusTexture) this.updateGreyoutStatus()
    if (config.enableSimulation) {
      if (!this.updatePositionCommand) {
        // Create vertex buffer for quad
        if (!this.updatePositionVertexCoordBuffer) {
          this.updatePositionVertexCoordBuffer = device.createBuffer({
            data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          })
        }

        // Create UniformStore for updatePosition uniforms
        if (!this.updatePositionUniformStore) {
          this.updatePositionUniformStore = new UniformStore({
            updatePositionUniforms: {
              uniformTypes: {
                // Order MUST match shader declaration order (std140 layout)
                friction: 'f32',
                spaceSize: 'f32',
              },
              defaultUniforms: {
                friction: config.simulationFriction ?? 0,
                spaceSize: store.adjustedSpaceSize ?? 0,
              },
            },
          })
        }

        this.updatePositionCommand = new Model(device, {
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
            updatePositionUniforms: this.updatePositionUniformStore.getManagedUniformBuffer(device, 'updatePositionUniforms'),
            ...(this.previousPositionTexture && { positionsTexture: this.previousPositionTexture }),
            ...(this.velocityTexture && { velocity: this.velocityTexture }),
          },
        })
      }
    }

    if (!this.dragPointCommand) {
      // Create vertex buffer for quad
      if (!this.dragPointVertexCoordBuffer) {
        this.dragPointVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      // Create UniformStore for dragPoint uniforms
      if (!this.dragPointUniformStore) {
        this.dragPointUniformStore = new UniformStore({
          dragPointUniforms: {
            uniformTypes: {
              // Order MUST match shader declaration order (std140 layout)
              mousePos: 'vec2<f32>',
              index: 'f32',
            },
            defaultUniforms: {
              mousePos: (store.mousePosition as [number, number]) ?? [0, 0],
              index: store.hoveredPoint?.index ?? -1,
            },
          },
        })
      }

      this.dragPointCommand = new Model(device, {
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
          dragPointUniforms: this.dragPointUniformStore.getManagedUniformBuffer(device, 'dragPointUniforms'),
          ...(this.previousPositionTexture && { positionsTexture: this.previousPositionTexture }),
        },
      })
    }

    if (!this.drawCommand) {
      // Create UniformStore for draw uniforms
      if (!this.drawUniformStore) {
        this.drawUniformStore = new UniformStore({
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
              skipSelected: 'f32',
              skipUnselected: 'f32',
              hasImages: 'f32',
              imageCount: 'f32',
              imageAtlasCoordsTextureSize: 'f32',
            },
            defaultUniforms: {
              // Order MUST match uniformTypes and shader declaration
              ratio: config.pixelRatio ?? defaultConfigValues.pixelRatio,
              transformationMatrix: ((): [
                number, number, number, number,
                number, number, number, number,
                number, number, number, number,
                number, number, number, number
              ] => {
                const t = store.transform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
                return [
                  t[0], t[1], t[2], 0,
                  t[3], t[4], t[5], 0,
                  t[6], t[7], t[8], 0,
                  0, 0, 0, 1,
                ]
              })(),
              pointsTextureSize: store.pointsTextureSize ?? 0,
              sizeScale: config.pointSizeScale ?? 1,
              spaceSize: store.adjustedSpaceSize ?? 0,
              screenSize: store.screenSize ?? [0, 0],
              greyoutColor: (store.greyoutPointColor ?? [0, 0, 0, 1]) as [number, number, number, number],
              backgroundColor: store.backgroundColor ?? [0, 0, 0, 1],
              scalePointsOnZoom: (config.scalePointsOnZoom ?? true) ? 1 : 0, // Convert boolean to float
              maxPointSize: store.maxPointSize ?? 100,
              isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
              skipSelected: 0, // Default to 0 (false)
              skipUnselected: 0, // Default to 0 (false)
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
            },
            defaultUniforms: {
              greyoutOpacity: config.pointGreyoutOpacity ?? -1,
              pointOpacity: config.pointOpacity ?? 1,
              isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
              backgroundColor: store.backgroundColor ?? [0, 0, 0, 1],
            },
          },
        })
      }

      this.drawCommand = new Model(device, {
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
          drawVertexUniforms: this.drawUniformStore.getManagedUniformBuffer(device, 'drawVertexUniforms'),
          drawFragmentUniforms: this.drawUniformStore.getManagedUniformBuffer(device, 'drawFragmentUniforms'),
          ...(this.currentPositionTexture && { positionsTexture: this.currentPositionTexture }),
          ...(this.greyoutStatusTexture && { pointGreyoutStatus: this.greyoutStatusTexture }),
          ...(this.imageAtlasTexture && { imageAtlasTexture: this.imageAtlasTexture }),
          ...(this.imageAtlasCoordsTexture && { imageAtlasCoords: this.imageAtlasCoordsTexture }),
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
    }

    if (!this.findPointsOnAreaSelectionCommand) {
      // Create vertex buffer for quad
      if (!this.findPointsOnAreaSelectionVertexCoordBuffer) {
        this.findPointsOnAreaSelectionVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      // Create UniformStore for findPointsOnAreaSelection uniforms
      if (!this.findPointsOnAreaSelectionUniformStore) {
        this.findPointsOnAreaSelectionUniformStore = new UniformStore({
          findPointsOnAreaSelectionUniforms: {
            uniformTypes: {
              // Order MUST match shader declaration order (std140 layout)
              sizeScale: 'f32',
              spaceSize: 'f32',
              screenSize: 'vec2<f32>',
              ratio: 'f32',
              transformationMatrix: 'mat4x4<f32>',
              selection0: 'vec2<f32>',
              selection1: 'vec2<f32>',
              scalePointsOnZoom: 'f32',
              maxPointSize: 'f32',
            },
            defaultUniforms: {
              sizeScale: config.pointSizeScale ?? 1,
              spaceSize: store.adjustedSpaceSize ?? 0,
              screenSize: store.screenSize ?? [0, 0],
              ratio: config.pixelRatio ?? defaultConfigValues.pixelRatio,
              transformationMatrix: store.transformationMatrix4x4,
              selection0: (store.selectedArea?.[0] ?? [0, 0]) as [number, number],
              selection1: (store.selectedArea?.[1] ?? [0, 0]) as [number, number],
              scalePointsOnZoom: (config.scalePointsOnZoom ?? true) ? 1 : 0,
              maxPointSize: store.maxPointSize ?? 100,
            },
          },
        })
      }

      this.findPointsOnAreaSelectionCommand = new Model(device, {
        fs: findPointsOnAreaSelectionFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.findPointsOnAreaSelectionVertexCoordBuffer,
        },
        bufferLayout: [
          { name: 'vertexCoord', format: 'float32x2' },
        ],
        defines: {
          USE_UNIFORM_BUFFERS: true,
        },
        bindings: {
          findPointsOnAreaSelectionUniforms: this.findPointsOnAreaSelectionUniformStore.getManagedUniformBuffer(device, 'findPointsOnAreaSelectionUniforms'),
          ...(this.currentPositionTexture && { positionsTexture: this.currentPositionTexture }),
          ...(this.sizeTexture && { pointSize: this.sizeTexture }),
        },
      })
    }

    if (!this.findPointsOnPolygonSelectionCommand) {
      // Create vertex buffer for quad
      if (!this.findPointsOnPolygonSelectionVertexCoordBuffer) {
        this.findPointsOnPolygonSelectionVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      // Create UniformStore for findPointsOnPolygonSelection uniforms
      if (!this.findPointsOnPolygonSelectionUniformStore) {
        this.findPointsOnPolygonSelectionUniformStore = new UniformStore({
          findPointsOnPolygonSelectionUniforms: {
            uniformTypes: {
              // Order MUST match shader declaration order (std140 layout)
              spaceSize: 'f32',
              screenSize: 'vec2<f32>',
              transformationMatrix: 'mat4x4<f32>',
              polygonPathLength: 'f32',
            },
            defaultUniforms: {
              spaceSize: store.adjustedSpaceSize ?? 0,
              screenSize: store.screenSize ?? [0, 0],
              transformationMatrix: store.transformationMatrix4x4,
              polygonPathLength: this.polygonPathLength,
            },
          },
        })
      }

      this.findPointsOnPolygonSelectionCommand = new Model(device, {
        fs: findPointsOnPolygonSelectionFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.findPointsOnPolygonSelectionVertexCoordBuffer,
        },
        bufferLayout: [
          { name: 'vertexCoord', format: 'float32x2' },
        ],
        defines: {
          USE_UNIFORM_BUFFERS: true,
        },
        bindings: {
          findPointsOnPolygonSelectionUniforms: this.findPointsOnPolygonSelectionUniformStore
            .getManagedUniformBuffer(device, 'findPointsOnPolygonSelectionUniforms'),
          ...(this.currentPositionTexture && { positionsTexture: this.currentPositionTexture }),
          ...(this.polygonPathTexture && { polygonPathTexture: this.polygonPathTexture }),
        },
      })
    }

    if (!this.clearHoveredFboCommand) {
      // Create vertex buffer for quad
      if (!this.clearHoveredFboVertexCoordBuffer) {
        this.clearHoveredFboVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      this.clearHoveredFboCommand = new Model(device, {
        fs: clearFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.clearHoveredFboVertexCoordBuffer,
        },
        bufferLayout: [
          { name: 'vertexCoord', format: 'float32x2' },
        ],
      })
    }

    if (!this.findHoveredPointCommand) {
      // Create UniformStore for findHoveredPoint uniforms
      if (!this.findHoveredPointUniformStore) {
        this.findHoveredPointUniformStore = new UniformStore({
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
            },
            defaultUniforms: {
              pointsTextureSize: store.pointsTextureSize ?? 0,
              sizeScale: config.pointSizeScale ?? 1,
              spaceSize: store.adjustedSpaceSize ?? 0,
              screenSize: store.screenSize ?? [0, 0],
              ratio: config.pixelRatio ?? defaultConfigValues.pixelRatio,
              transformationMatrix: store.transformationMatrix4x4,
              mousePosition: store.screenMousePosition ?? [0, 0],
              scalePointsOnZoom: (config.scalePointsOnZoom ?? true) ? 1 : 0,
              maxPointSize: store.maxPointSize ?? 100,
            },
          },
        })
      }

      this.findHoveredPointCommand = new Model(device, {
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
          findHoveredPointUniforms: this.findHoveredPointUniformStore.getManagedUniformBuffer(device, 'findHoveredPointUniforms'),
          ...(this.currentPositionTexture && { positionsTexture: this.currentPositionTexture }),
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
          blend: false, // Disable blending - we want to overwrite, not blend
        },
      })
    }

    if (!this.clearSampledPointsFboCommand) {
      // Create vertex buffer for quad
      if (!this.clearSampledPointsFboVertexCoordBuffer) {
        this.clearSampledPointsFboVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      this.clearSampledPointsFboCommand = new Model(device, {
        fs: clearFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.clearSampledPointsFboVertexCoordBuffer,
        },
        bufferLayout: [
          { name: 'vertexCoord', format: 'float32x2' },
        ],
      })
    }

    if (!this.fillSampledPointsFboCommand) {
      // Create UniformStore for fillSampledPoints uniforms
      if (!this.fillSampledPointsUniformStore) {
        this.fillSampledPointsUniformStore = new UniformStore({
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
              spaceSize: store.adjustedSpaceSize ?? 0,
              screenSize: store.screenSize ?? [0, 0],
            },
          },
        })
      }

      this.fillSampledPointsFboCommand = new Model(device, {
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
          fillSampledPointsUniforms: this.fillSampledPointsUniformStore.getManagedUniformBuffer(device, 'fillSampledPointsUniforms'),
          ...(this.currentPositionTexture && { positionsTexture: this.currentPositionTexture }),
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })
    }

    if (!this.drawHighlightedCommand) {
      if (!this.drawHighlightedVertexCoordBuffer) {
        this.drawHighlightedVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      if (!this.drawHighlightedUniformStore) {
        this.drawHighlightedUniformStore = new UniformStore({
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
              sizeScale: config.pointSizeScale ?? 1,
              spaceSize: store.adjustedSpaceSize ?? 0,
              screenSize: store.screenSize ?? [0, 0],
              scalePointsOnZoom: (config.scalePointsOnZoom ?? true) ? 1 : 0,
              pointIndex: -1,
              maxPointSize: store.maxPointSize ?? 100,
              color: [0, 0, 0, 1] as [number, number, number, number],
              universalPointOpacity: config.pointOpacity ?? 1,
              greyoutOpacity: config.pointGreyoutOpacity ?? -1,
              isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0,
              backgroundColor: store.backgroundColor ?? [0, 0, 0, 1],
              greyoutColor: (store.greyoutPointColor ?? [0, 0, 0, 1]) as [number, number, number, number],
              width: 0.85,
            },
          },
        })
      }

      this.drawHighlightedCommand = new Model(device, {
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
          drawHighlightedUniforms: this.drawHighlightedUniformStore.getManagedUniformBuffer(device, 'drawHighlightedUniforms'),
          ...(this.currentPositionTexture && { positionsTexture: this.currentPositionTexture }),
          ...(this.greyoutStatusTexture && { pointGreyoutStatusTexture: this.greyoutStatusTexture }),
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
    }

    if (!this.trackPointsCommand) {
      // Create vertex buffer for quad
      if (!this.trackPointsVertexCoordBuffer) {
        this.trackPointsVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      // Create UniformStore for trackPoints uniforms
      if (!this.trackPointsUniformStore) {
        this.trackPointsUniformStore = new UniformStore({
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
      }

      this.trackPointsCommand = new Model(device, {
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
          trackPointsUniforms: this.trackPointsUniformStore.getManagedUniformBuffer(device, 'trackPointsUniforms'),
          ...(this.currentPositionTexture && { positionsTexture: this.currentPositionTexture }),
          ...(this.trackedIndicesTexture && { trackedIndices: this.trackedIndicesTexture }),
        },
      })
    }
  }

  public updateColor (): void {
    const { device, store: { pointsTextureSize }, data } = this
    if (!pointsTextureSize) return

    const colorData = data.pointColors as Float32Array
    const requiredByteLength = colorData.byteLength

    if (!this.colorBuffer || this.colorBuffer.byteLength !== requiredByteLength) {
      this.colorBuffer?.destroy()
      this.colorBuffer = device.createBuffer({
        data: colorData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.colorBuffer.write(colorData)
    }
  }

  public updateGreyoutStatus (): void {
    const { device, store: { selectedIndices, pointsTextureSize } } = this
    if (!pointsTextureSize) return

    // Greyout status: 0 - false, highlighted or normal point; 1 - true, greyout point
    const initialState = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
      .fill(selectedIndices ? 1 : 0)

    if (selectedIndices) {
      for (const selectedIndex of selectedIndices) {
        initialState[selectedIndex * 4] = 0
      }
    }

    if (!this.greyoutStatusTexture || this.greyoutStatusTexture.width !== pointsTextureSize || this.greyoutStatusTexture.height !== pointsTextureSize) {
      if (this.greyoutStatusTexture) {
        this.greyoutStatusTexture.destroy()
      }
      if (this.greyoutStatusFbo) {
        this.greyoutStatusFbo.destroy()
      }
      this.greyoutStatusTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.greyoutStatusTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.greyoutStatusFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.greyoutStatusTexture],
      })
    } else {
      this.greyoutStatusTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }
  }

  public updatePinnedStatus (): void {
    const { reglInstance, store: { pointsTextureSize }, data } = this
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

    if (!this.pinnedStatusTexture) this.pinnedStatusTexture = reglInstance.texture()
    this.pinnedStatusTexture({
      data: initialState,
      width: pointsTextureSize,
      height: pointsTextureSize,
      type: 'float',
    })
    if (!this.pinnedStatusFbo) this.pinnedStatusFbo = reglInstance.framebuffer()
    this.pinnedStatusFbo({
      color: this.pinnedStatusTexture,
      depth: false,
      stencil: false,
    })
  }

  public updateSize (): void {
    const { device, store: { pointsTextureSize }, data } = this
    if (!pointsTextureSize || data.pointsNumber === undefined || data.pointSizes === undefined) return

    const sizeData = data.pointSizes
    const requiredByteLength = sizeData.byteLength

    if (!this.sizeBuffer || this.sizeBuffer.byteLength !== requiredByteLength) {
      this.sizeBuffer?.destroy()
      this.sizeBuffer = device.createBuffer({
        data: sizeData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.sizeBuffer.write(sizeData)
    }

    const initialState = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
    for (let i = 0; i < data.pointsNumber; i++) {
      initialState[i * 4] = data.pointSizes[i] as number
    }

    if (!this.sizeTexture || this.sizeTexture.width !== pointsTextureSize || this.sizeTexture.height !== pointsTextureSize) {
      if (this.sizeTexture) {
        this.sizeTexture.destroy()
      }
      if (this.sizeFbo) {
        this.sizeFbo.destroy()
      }
      this.sizeTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      this.sizeTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.sizeFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.sizeTexture],
      })
    } else {
      this.sizeTexture.copyImageData({
        data: initialState,
        bytesPerRow: pointsTextureSize,
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
      this.shapeBuffer?.destroy()
      this.shapeBuffer = device.createBuffer({
        data: shapeData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.shapeBuffer.write(shapeData)
    }
  }

  public updateImageIndices (): void {
    const { device, data } = this
    if (data.pointsNumber === undefined || data.pointImageIndices === undefined) return

    const imageIndicesData = data.pointImageIndices
    const requiredByteLength = imageIndicesData.byteLength

    if (!this.imageIndicesBuffer || this.imageIndicesBuffer.byteLength !== requiredByteLength) {
      this.imageIndicesBuffer?.destroy()
      this.imageIndicesBuffer = device.createBuffer({
        data: imageIndicesData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.imageIndicesBuffer.write(imageIndicesData)
    }
  }

  public updateImageSizes (): void {
    const { device, data } = this
    if (data.pointsNumber === undefined || data.pointImageSizes === undefined) return

    const imageSizesData = data.pointImageSizes
    const requiredByteLength = imageSizesData.byteLength

    if (!this.imageSizesBuffer || this.imageSizesBuffer.byteLength !== requiredByteLength) {
      this.imageSizesBuffer?.destroy()
      this.imageSizesBuffer = device.createBuffer({
        data: imageSizesData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.imageSizesBuffer.write(imageSizesData)
    }
  }

  public createAtlas (): void {
    const { device, data, store } = this

    if (!data.inputImageData?.length) {
      this.imageCount = 0
      this.imageAtlasCoordsTextureSize = 0
      // Create dummy textures so bindings are always available
      if (!this.imageAtlasCoordsTexture) {
        this.imageAtlasCoordsTexture = device.createTexture({
          data: new Float32Array(4).fill(0),
          width: 1,
          height: 1,
          format: 'rgba32float',
        })
      }
      if (!this.imageAtlasTexture) {
        this.imageAtlasTexture = device.createTexture({
          data: new Uint8Array(4).fill(0),
          width: 1,
          height: 1,
          format: 'rgba8unorm',
        })
      }
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
    this.imageAtlasTexture?.destroy()
    this.imageAtlasTexture = device.createTexture({
      width: atlasSize,
      height: atlasSize,
      format: 'rgba8unorm',
    })
    this.imageAtlasTexture.copyImageData({
      data: atlasData,
      // UNPACK_ROW_LENGTH and UNPACK_IMAGE_HEIGHT expect pixel counts (not bytes)
      bytesPerRow: atlasSize,
      rowsPerImage: atlasSize,
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    // Recreate coords texture
    this.imageAtlasCoordsTexture?.destroy()
    this.imageAtlasCoordsTexture = device.createTexture({
      width: atlasCoordsSize,
      height: atlasCoordsSize,
      format: 'rgba32float',
    })
    this.imageAtlasCoordsTexture.copyImageData({
      data: atlasCoords,
      // UNPACK_ROW_LENGTH and UNPACK_IMAGE_HEIGHT expect pixel counts (not bytes)
      bytesPerRow: atlasCoordsSize,
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

    this.trackPointsCommand.setBindings({
      trackPointsUniforms: this.trackPointsUniformStore.getManagedUniformBuffer(this.device, 'trackPointsUniforms'),
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
    if (!this.greyoutStatusTexture || this.greyoutStatusTexture.destroyed) return
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
      sizeScale: config.pointSizeScale ?? 1,
      spaceSize: store.adjustedSpaceSize ?? 0,
      screenSize: store.screenSize ?? [0, 0],
      greyoutColor: (store.greyoutPointColor ?? [-1, -1, -1, -1]) as [number, number, number, number],
      backgroundColor: store.backgroundColor ?? [0, 0, 0, 1],
      scalePointsOnZoom: (config.scalePointsOnZoom ?? true) ? 1 : 0, // Convert boolean to float
      maxPointSize: store.maxPointSize ?? 100,
      isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
      hasImages: (this.imageCount > 0) ? 1 : 0, // Convert boolean to float
      imageCount: this.imageCount,
      imageAtlasCoordsTextureSize: this.imageAtlasCoordsTextureSize ?? 0,
    }

    const baseFragmentUniforms = {
      greyoutOpacity: config.pointGreyoutOpacity ?? -1,
      pointOpacity: config.pointOpacity ?? 1,
      isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0, // Convert boolean to float
      backgroundColor: store.backgroundColor ?? [0, 0, 0, 1],
    }

    // Render in layers: unselected points first (behind), then selected points (in front)
    if (store.selectedIndices && store.selectedIndices.length > 0) {
      // First draw unselected points (they will appear behind)
      this.drawUniformStore.setUniforms({
        drawVertexUniforms: {
          ...baseVertexUniforms,
          skipSelected: 1, // Skip selected points (1.0 for true)
          skipUnselected: 0, // Draw unselected points (0.0 for false)
        },
        drawFragmentUniforms: baseFragmentUniforms,
      })

      this.drawCommand.setBindings({
        drawVertexUniforms: this.drawUniformStore.getManagedUniformBuffer(this.device, 'drawVertexUniforms'),
        drawFragmentUniforms: this.drawUniformStore.getManagedUniformBuffer(this.device, 'drawFragmentUniforms'),
        positionsTexture: this.currentPositionTexture,
        pointGreyoutStatus: this.greyoutStatusTexture,
        imageAtlasTexture: this.imageAtlasTexture,
        imageAtlasCoords: this.imageAtlasCoordsTexture,
      })

      this.drawCommand.draw(renderPass)

      // Then draw selected points (they will appear in front)
      this.drawUniformStore.setUniforms({
        drawVertexUniforms: {
          ...baseVertexUniforms,
          skipSelected: 0, // Draw selected points (0.0 for false)
          skipUnselected: 1, // Skip unselected points (1.0 for true)
        },
        drawFragmentUniforms: baseFragmentUniforms,
      })

      this.drawCommand.setBindings({
        drawVertexUniforms: this.drawUniformStore.getManagedUniformBuffer(this.device, 'drawVertexUniforms'),
        drawFragmentUniforms: this.drawUniformStore.getManagedUniformBuffer(this.device, 'drawFragmentUniforms'),
        positionsTexture: this.currentPositionTexture,
        pointGreyoutStatus: this.greyoutStatusTexture,
        imageAtlasTexture: this.imageAtlasTexture,
        imageAtlasCoords: this.imageAtlasCoordsTexture,
      })

      this.drawCommand.draw(renderPass)
    } else {
      // If no selection, draw all points
      this.drawUniformStore.setUniforms({
        drawVertexUniforms: {
          ...baseVertexUniforms,
          skipSelected: 0, // Draw all points (0.0 for false)
          skipUnselected: 0, // Draw all points (0.0 for false)
        },
        drawFragmentUniforms: baseFragmentUniforms,
      })

      this.drawCommand.setBindings({
        drawVertexUniforms: this.drawUniformStore.getManagedUniformBuffer(this.device, 'drawVertexUniforms'),
        drawFragmentUniforms: this.drawUniformStore.getManagedUniformBuffer(this.device, 'drawFragmentUniforms'),
        positionsTexture: this.currentPositionTexture,
        pointGreyoutStatus: this.greyoutStatusTexture,
        imageAtlasTexture: this.imageAtlasTexture,
        imageAtlasCoords: this.imageAtlasCoordsTexture,
      })

      this.drawCommand.draw(renderPass)
    }

    // Draw highlighted point rings if enabled
    if (config.renderHoveredPointRing && store.hoveredPoint && this.drawHighlightedCommand && this.drawHighlightedUniformStore) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
      if (!this.greyoutStatusTexture || this.greyoutStatusTexture.destroyed) return
      const pointSize = data.pointSizes?.[store.hoveredPoint.index] ?? 1
      this.drawHighlightedUniformStore.setUniforms({
        drawHighlightedUniforms: {
          size: pointSize,
          transformationMatrix: store.transformationMatrix4x4,
          pointsTextureSize: store.pointsTextureSize ?? 0,
          sizeScale: config.pointSizeScale ?? 1,
          spaceSize: store.adjustedSpaceSize ?? 0,
          screenSize: store.screenSize ?? [0, 0],
          scalePointsOnZoom: (config.scalePointsOnZoom ?? true) ? 1 : 0,
          pointIndex: store.hoveredPoint.index,
          maxPointSize: store.maxPointSize ?? 100,
          color: (store.hoveredPointRingColor as [number, number, number, number]),
          universalPointOpacity: config.pointOpacity ?? 1,
          greyoutOpacity: config.pointGreyoutOpacity ?? -1,
          isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0,
          backgroundColor: store.backgroundColor ?? [0, 0, 0, 1],
          greyoutColor: (store.greyoutPointColor ?? [0, 0, 0, 1]) as [number, number, number, number],
          width: 0.85,
        },
      })
      this.drawHighlightedCommand.setBindings({
        drawHighlightedUniforms: this.drawHighlightedUniformStore.getManagedUniformBuffer(this.device, 'drawHighlightedUniforms'),
        positionsTexture: this.currentPositionTexture,
        pointGreyoutStatusTexture: this.greyoutStatusTexture,
      })
      this.drawHighlightedCommand.draw(renderPass)
    }

    if (store.focusedPoint && this.drawHighlightedCommand && this.drawHighlightedUniformStore) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
      if (!this.greyoutStatusTexture || this.greyoutStatusTexture.destroyed) return
      const pointSize = data.pointSizes?.[store.focusedPoint.index] ?? 1
      this.drawHighlightedUniformStore.setUniforms({
        drawHighlightedUniforms: {
          size: pointSize,
          transformationMatrix: store.transformationMatrix4x4,
          pointsTextureSize: store.pointsTextureSize ?? 0,
          sizeScale: config.pointSizeScale ?? 1,
          spaceSize: store.adjustedSpaceSize ?? 0,
          screenSize: store.screenSize ?? [0, 0],
          scalePointsOnZoom: (config.scalePointsOnZoom ?? true) ? 1 : 0,
          pointIndex: store.focusedPoint.index,
          maxPointSize: store.maxPointSize ?? 100,
          color: (store.focusedPointRingColor as [number, number, number, number]),
          universalPointOpacity: config.pointOpacity ?? 1,
          greyoutOpacity: config.pointGreyoutOpacity ?? -1,
          isDarkenGreyout: (store.isDarkenGreyout ?? false) ? 1 : 0,
          backgroundColor: store.backgroundColor ?? [0, 0, 0, 1],
          greyoutColor: (store.greyoutPointColor ?? [0, 0, 0, 1]) as [number, number, number, number],
          width: 0.85,
        },
      })
      this.drawHighlightedCommand.setBindings({
        drawHighlightedUniforms: this.drawHighlightedUniformStore.getManagedUniformBuffer(this.device, 'drawHighlightedUniforms'),
        positionsTexture: this.currentPositionTexture,
        pointGreyoutStatusTexture: this.greyoutStatusTexture,
      })
      this.drawHighlightedCommand.draw(renderPass)
    }
  }

  public updatePosition (): void {
    if (!this.updatePositionCommand || !this.updatePositionUniformStore || !this.currentPositionFbo || this.currentPositionFbo.destroyed) return
    if (!this.previousPositionTexture || this.previousPositionTexture.destroyed) return
    if (!this.velocityTexture || this.velocityTexture.destroyed) return

    this.updatePositionUniformStore.setUniforms({
      updatePositionUniforms: {
        friction: this.config.simulationFriction ?? 0,
        spaceSize: this.store.adjustedSpaceSize ?? 0,
      },
    })

    this.updatePositionCommand.setBindings({
      updatePositionUniforms: this.updatePositionUniformStore.getManagedUniformBuffer(this.device, 'updatePositionUniforms'),
      positionsTexture: this.previousPositionTexture,
      velocity: this.velocityTexture,
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
        mousePos: (this.store.mousePosition as [number, number]) ?? [0, 0],
        index: this.store.hoveredPoint?.index ?? -1,
      },
    })

    this.dragPointCommand.setBindings({
      dragPointUniforms: this.dragPointUniformStore.getManagedUniformBuffer(this.device, 'dragPointUniforms'),
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

  public findPointsOnAreaSelection (): void {
    if (!this.findPointsOnAreaSelectionCommand || !this.findPointsOnAreaSelectionUniformStore || !this.selectedFbo || this.selectedFbo.destroyed) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
    if (!this.sizeTexture || this.sizeTexture.destroyed) return

    this.findPointsOnAreaSelectionUniformStore.setUniforms({
      findPointsOnAreaSelectionUniforms: {
        spaceSize: this.store.adjustedSpaceSize ?? 0,
        screenSize: this.store.screenSize ?? [0, 0],
        sizeScale: this.config.pointSizeScale ?? 1,
        transformationMatrix: this.store.transformationMatrix4x4,
        ratio: this.config.pixelRatio ?? defaultConfigValues.pixelRatio,
        selection0: (this.store.selectedArea?.[0] ?? [0, 0]) as [number, number],
        selection1: (this.store.selectedArea?.[1] ?? [0, 0]) as [number, number],
        scalePointsOnZoom: (this.config.scalePointsOnZoom ?? true) ? 1 : 0, // Convert boolean to number
        maxPointSize: this.store.maxPointSize ?? 100,
      },
    })

    this.findPointsOnAreaSelectionCommand.setBindings({
      findPointsOnAreaSelectionUniforms: this.findPointsOnAreaSelectionUniformStore.getManagedUniformBuffer(this.device, 'findPointsOnAreaSelectionUniforms'),
      positionsTexture: this.currentPositionTexture,
      pointSize: this.sizeTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.selectedFbo,
    })
    this.findPointsOnAreaSelectionCommand.draw(renderPass)
    renderPass.end()
  }

  public findPointsOnPolygonSelection (): void {
    if (!this.findPointsOnPolygonSelectionCommand || !this.findPointsOnPolygonSelectionUniformStore || !this.selectedFbo || this.selectedFbo.destroyed) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return
    if (!this.polygonPathTexture || this.polygonPathTexture.destroyed) return

    this.findPointsOnPolygonSelectionUniformStore.setUniforms({
      findPointsOnPolygonSelectionUniforms: {
        spaceSize: this.store.adjustedSpaceSize ?? 0,
        screenSize: this.store.screenSize ?? [0, 0],
        transformationMatrix: this.store.transformationMatrix4x4,
        polygonPathLength: this.polygonPathLength,
      },
    })

    this.findPointsOnPolygonSelectionCommand.setBindings({
      findPointsOnPolygonSelectionUniforms: this.findPointsOnPolygonSelectionUniformStore
        .getManagedUniformBuffer(this.device, 'findPointsOnPolygonSelectionUniforms'),
      positionsTexture: this.currentPositionTexture,
      polygonPathTexture: this.polygonPathTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.selectedFbo,
    })
    this.findPointsOnPolygonSelectionCommand.draw(renderPass)
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
      if (this.polygonPathFbo && !this.polygonPathFbo.destroyed) {
        this.polygonPathFbo.destroy()
      }
      this.polygonPathFbo = undefined
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
      if (this.polygonPathFbo && !this.polygonPathFbo.destroyed) {
        this.polygonPathFbo.destroy()
      }
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
        bytesPerRow: textureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.polygonPathFbo = device.createFramebuffer({
        width: textureSize,
        height: textureSize,
        colorAttachments: [this.polygonPathTexture],
      })
    } else {
      this.polygonPathTexture.copyImageData({
        data: textureData,
        bytesPerRow: textureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }
  }

  public findHoveredPoint (): void {
    if (!this.hoveredFbo || this.hoveredFbo.destroyed) return

    if (this.clearHoveredFboCommand) {
      const clearPass = this.device.beginRenderPass({
        framebuffer: this.hoveredFbo,
      })
      this.clearHoveredFboCommand.draw(clearPass)
      clearPass.end()
    }

    if (!this.findHoveredPointCommand || !this.findHoveredPointUniformStore) return
    if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return

    this.findHoveredPointCommand.setVertexCount(this.data.pointsNumber ?? 0)

    this.findHoveredPointCommand.setAttributes({
      ...(this.hoveredPointIndices && { pointIndices: this.hoveredPointIndices }),
      ...(this.sizeBuffer && { size: this.sizeBuffer }),
    })

    this.findHoveredPointUniformStore.setUniforms({
      findHoveredPointUniforms: {
        ratio: this.config.pixelRatio ?? defaultConfigValues.pixelRatio,
        sizeScale: this.config.pointSizeScale ?? 1,
        pointsTextureSize: this.store.pointsTextureSize ?? 0,
        transformationMatrix: this.store.transformationMatrix4x4,
        spaceSize: this.store.adjustedSpaceSize ?? 0,
        screenSize: this.store.screenSize ?? [0, 0],
        scalePointsOnZoom: (this.config.scalePointsOnZoom ?? true) ? 1 : 0,
        mousePosition: (this.store.screenMousePosition ?? [0, 0]) as [number, number],
        maxPointSize: this.store.maxPointSize ?? 100,
      },
    })

    this.findHoveredPointCommand.setBindings({
      findHoveredPointUniforms: this.findHoveredPointUniformStore.getManagedUniformBuffer(this.device, 'findHoveredPointUniforms'),
      positionsTexture: this.currentPositionTexture,
    })

    const renderPass = this.device.beginRenderPass({
      framebuffer: this.hoveredFbo,
    })
    this.findHoveredPointCommand.draw(renderPass)
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
      if (this.trackedIndicesFbo && !this.trackedIndicesFbo.destroyed) {
        this.trackedIndicesFbo.destroy()
      }
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
        bytesPerRow: textureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      this.trackedIndicesFbo = device.createFramebuffer({
        width: textureSize,
        height: textureSize,
        colorAttachments: [this.trackedIndicesTexture],
      })
    } else {
      this.trackedIndicesTexture.copyImageData({
        data: initialState,
        bytesPerRow: textureSize,
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

    // Clear sampled points FBO
    if (this.clearSampledPointsFboCommand) {
      const clearPass = this.device.beginRenderPass({
        framebuffer: this.sampledPointsFbo,
      })
      this.clearSampledPointsFboCommand.draw(clearPass)
      clearPass.end()
    }

    // Fill sampled points FBO
    if (this.fillSampledPointsFboCommand && this.fillSampledPointsUniformStore && this.sampledPointsFbo) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return positions
      // Update vertex count dynamically
      this.fillSampledPointsFboCommand.setVertexCount(this.data.pointsNumber ?? 0)

      this.fillSampledPointsUniformStore.setUniforms({
        fillSampledPointsUniforms: {
          pointsTextureSize: this.store.pointsTextureSize ?? 0,
          transformationMatrix: this.store.transformationMatrix4x4,
          spaceSize: this.store.adjustedSpaceSize ?? 0,
          screenSize: this.store.screenSize ?? [0, 0],
        },
      })

      this.fillSampledPointsFboCommand.setBindings({
        fillSampledPointsUniforms: this.fillSampledPointsUniformStore.getManagedUniformBuffer(this.device, 'fillSampledPointsUniforms'),
        positionsTexture: this.currentPositionTexture,
      })

      const fillPass = this.device.beginRenderPass({
        framebuffer: this.sampledPointsFbo,
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

    // Clear sampled points FBO
    if (this.clearSampledPointsFboCommand) {
      const clearPass = this.device.beginRenderPass({
        framebuffer: this.sampledPointsFbo,
      })
      this.clearSampledPointsFboCommand.draw(clearPass)
      clearPass.end()
    }

    // Fill sampled points FBO
    if (this.fillSampledPointsFboCommand && this.fillSampledPointsUniformStore && this.sampledPointsFbo) {
      if (!this.currentPositionTexture || this.currentPositionTexture.destroyed) return { indices, positions }
      // Update vertex count dynamically
      this.fillSampledPointsFboCommand.setVertexCount(this.data.pointsNumber ?? 0)

      this.fillSampledPointsUniformStore.setUniforms({
        fillSampledPointsUniforms: {
          pointsTextureSize: this.store.pointsTextureSize ?? 0,
          transformationMatrix: this.store.transformationMatrix4x4,
          spaceSize: this.store.adjustedSpaceSize ?? 0,
          screenSize: this.store.screenSize ?? [0, 0],
        },
      })

      this.fillSampledPointsFboCommand.setBindings({
        fillSampledPointsUniforms: this.fillSampledPointsUniformStore.getManagedUniformBuffer(this.device, 'fillSampledPointsUniforms'),
        positionsTexture: this.currentPositionTexture,
      })

      const fillPass = this.device.beginRenderPass({
        framebuffer: this.sampledPointsFbo,
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

  public destroy (): void {
    // Destroy UniformStore instances
    this.updatePositionUniformStore?.destroy()
    this.updatePositionUniformStore = undefined
    this.dragPointUniformStore?.destroy()
    this.dragPointUniformStore = undefined
    this.drawUniformStore?.destroy()
    this.drawUniformStore = undefined
    this.findPointsOnAreaSelectionUniformStore?.destroy()
    this.findPointsOnAreaSelectionUniformStore = undefined
    this.findPointsOnPolygonSelectionUniformStore?.destroy()
    this.findPointsOnPolygonSelectionUniformStore = undefined
    this.findHoveredPointUniformStore?.destroy()
    this.findHoveredPointUniformStore = undefined
    this.fillSampledPointsUniformStore?.destroy()
    this.fillSampledPointsUniformStore = undefined
    this.drawHighlightedUniformStore?.destroy()
    this.drawHighlightedUniformStore = undefined
    this.trackPointsUniformStore?.destroy()
    this.trackPointsUniformStore = undefined

    // Destroy Models
    this.drawCommand?.destroy()
    this.drawCommand = undefined
    this.drawHighlightedCommand?.destroy()
    this.drawHighlightedCommand = undefined
    this.updatePositionCommand?.destroy()
    this.updatePositionCommand = undefined
    this.dragPointCommand?.destroy()
    this.dragPointCommand = undefined
    this.findPointsOnAreaSelectionCommand?.destroy()
    this.findPointsOnAreaSelectionCommand = undefined
    this.findPointsOnPolygonSelectionCommand?.destroy()
    this.findPointsOnPolygonSelectionCommand = undefined
    this.findHoveredPointCommand?.destroy()
    this.findHoveredPointCommand = undefined
    this.clearHoveredFboCommand?.destroy()
    this.clearHoveredFboCommand = undefined
    this.clearSampledPointsFboCommand?.destroy()
    this.clearSampledPointsFboCommand = undefined
    this.fillSampledPointsFboCommand?.destroy()
    this.fillSampledPointsFboCommand = undefined
    this.trackPointsCommand?.destroy()
    this.trackPointsCommand = undefined

    // Destroy Framebuffers (destroy before textures they reference)
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
    if (this.selectedFbo && !this.selectedFbo.destroyed) {
      this.selectedFbo.destroy()
    }
    this.selectedFbo = undefined
    if (this.hoveredFbo && !this.hoveredFbo.destroyed) {
      this.hoveredFbo.destroy()
    }
    this.hoveredFbo = undefined
    if (this.greyoutStatusFbo && !this.greyoutStatusFbo.destroyed) {
      this.greyoutStatusFbo.destroy()
    }
    this.greyoutStatusFbo = undefined
    if (this.sizeFbo && !this.sizeFbo.destroyed) {
      this.sizeFbo.destroy()
    }
    this.sizeFbo = undefined
    if (this.trackedIndicesFbo && !this.trackedIndicesFbo.destroyed) {
      this.trackedIndicesFbo.destroy()
    }
    this.trackedIndicesFbo = undefined
    if (this.trackedPositionsFbo && !this.trackedPositionsFbo.destroyed) {
      this.trackedPositionsFbo.destroy()
    }
    this.trackedPositionsFbo = undefined
    if (this.sampledPointsFbo && !this.sampledPointsFbo.destroyed) {
      this.sampledPointsFbo.destroy()
    }
    this.sampledPointsFbo = undefined
    if (this.polygonPathFbo && !this.polygonPathFbo.destroyed) {
      this.polygonPathFbo.destroy()
    }
    this.polygonPathFbo = undefined

    // Destroy Textures
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
    if (this.selectedTexture && !this.selectedTexture.destroyed) {
      this.selectedTexture.destroy()
    }
    this.selectedTexture = undefined
    if (this.greyoutStatusTexture && !this.greyoutStatusTexture.destroyed) {
      this.greyoutStatusTexture.destroy()
    }
    this.greyoutStatusTexture = undefined
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

    // Destroy Buffers
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

    // Destroy attribute buffers (Model doesn't destroy them automatically)
    if (this.updatePositionVertexCoordBuffer && !this.updatePositionVertexCoordBuffer.destroyed) {
      this.updatePositionVertexCoordBuffer.destroy()
    }
    this.updatePositionVertexCoordBuffer = undefined
    if (this.dragPointVertexCoordBuffer && !this.dragPointVertexCoordBuffer.destroyed) {
      this.dragPointVertexCoordBuffer.destroy()
    }
    this.dragPointVertexCoordBuffer = undefined
    if (this.findPointsOnAreaSelectionVertexCoordBuffer && !this.findPointsOnAreaSelectionVertexCoordBuffer.destroyed) {
      this.findPointsOnAreaSelectionVertexCoordBuffer.destroy()
    }
    this.findPointsOnAreaSelectionVertexCoordBuffer = undefined
    if (this.findPointsOnPolygonSelectionVertexCoordBuffer && !this.findPointsOnPolygonSelectionVertexCoordBuffer.destroyed) {
      this.findPointsOnPolygonSelectionVertexCoordBuffer.destroy()
    }
    this.findPointsOnPolygonSelectionVertexCoordBuffer = undefined
    if (this.clearHoveredFboVertexCoordBuffer && !this.clearHoveredFboVertexCoordBuffer.destroyed) {
      this.clearHoveredFboVertexCoordBuffer.destroy()
    }
    this.clearHoveredFboVertexCoordBuffer = undefined
    if (this.clearSampledPointsFboVertexCoordBuffer && !this.clearSampledPointsFboVertexCoordBuffer.destroyed) {
      this.clearSampledPointsFboVertexCoordBuffer.destroy()
    }
    this.clearSampledPointsFboVertexCoordBuffer = undefined
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
    // Center the data horizontally by adding padding on x-axis
    const offsetX = ((range - w) / 2) * scaleFactor
    // Center the data vertically by adding padding on y-axis
    const offsetY = ((range - h) / 2) * scaleFactor

    this.scaleX = (x: number): number => (x - minX) * scaleFactor + offsetX
    this.scaleY = (y: number): number => (y - minY) * scaleFactor + offsetY

    // Apply scaling to point positions
    for (let i = 0; i < pointsNumber; i++) {
      this.data.pointPositions[i * 2] = this.scaleX(points[i * 2] as number)
      this.data.pointPositions[i * 2 + 1] = this.scaleY(points[i * 2 + 1] as number)
    }
  }
}
