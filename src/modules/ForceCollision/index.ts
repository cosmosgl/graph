import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import buildGridVert from '@/graph/modules/ForceCollision/build-grid.vert'
import buildGridFrag from '@/graph/modules/ForceCollision/build-grid.frag'
import forceFrag from '@/graph/modules/ForceCollision/force-collision-spatial.frag'
import clearFrag from '@/graph/modules/Shared/clear.frag'
import { createIndexesForBuffer, createQuadBuffer } from '@/graph/modules/Shared/buffer'
import updateVert from '@/graph/modules/Shared/quad.vert'

// Grid offsets for multiple passes (improves collision detection at cell boundaries)
const GRID_OFFSETS: [number, number][] = [
  [0.0, 0.0],
  [0.5, 0.0],
  [0.0, 0.5],
  [0.5, 0.5],
]

export class ForceCollision extends CoreModule {
  private gridFbo: regl.Framebuffer2D | undefined
  private sizeTexture: regl.Texture2D | undefined
  private sizeFbo: regl.Framebuffer2D | undefined
  private clearGridCommand: regl.DrawCommand | undefined
  private buildGridCommand: regl.DrawCommand | undefined
  private runCommand: regl.DrawCommand | undefined
  private pointIndices: regl.Buffer | undefined
  private gridTextureSize = 0
  private cellSize = 0

  public create (): void {
    const { reglInstance, store, data, config } = this
    if (!store.pointsTextureSize || data.pointsNumber === undefined) return

    // Calculate grid size based on space size and collision radius
    const defaultSize = config.pointSize ?? 4
    const maxSize = data.pointSizes
      ? Math.max(...Array.from(data.pointSizes))
      : defaultSize
    const collisionRadius = config.simulationCollisionRadius ?? 0
    const effectiveRadius = collisionRadius > 0 ? collisionRadius : maxSize * 0.5

    // Cell size = collision radius (smaller cells = better accuracy)
    // We use multiple offset passes to catch boundary collisions
    this.cellSize = Math.max(effectiveRadius, 8)

    // Grid texture size = space size / cell size, clamped to reasonable values
    this.gridTextureSize = Math.min(
      512, // Increased max grid size for better resolution
      Math.max(32, Math.ceil(store.adjustedSpaceSize / this.cellSize))
    )

    // Recalculate cell size to fit the grid evenly
    this.cellSize = store.adjustedSpaceSize / this.gridTextureSize

    // Create grid framebuffer
    if (!this.gridFbo) this.gridFbo = reglInstance.framebuffer()
    this.gridFbo({
      shape: [this.gridTextureSize, this.gridTextureSize],
      colorType: 'float',
      depth: false,
      stencil: false,
    })

    // Create size texture for collision radius calculation
    const sizeState = new Float32Array(store.pointsTextureSize * store.pointsTextureSize * 4)
    for (let i = 0; i < data.pointsNumber; i++) {
      sizeState[i * 4] = data.pointSizes?.[i] ?? defaultSize
    }

    if (!this.sizeTexture) this.sizeTexture = reglInstance.texture()
    this.sizeTexture({
      data: sizeState,
      width: store.pointsTextureSize,
      height: store.pointsTextureSize,
      type: 'float',
    })

    if (!this.sizeFbo) this.sizeFbo = reglInstance.framebuffer()
    this.sizeFbo({
      color: this.sizeTexture,
      depth: false,
      stencil: false,
    })

    // Create point indices buffer
    if (!this.pointIndices) this.pointIndices = reglInstance.buffer(0)
    this.pointIndices(createIndexesForBuffer(store.pointsTextureSize))
  }

  public initPrograms (): void {
    const { reglInstance, config, store, data, points } = this

    // Clear grid command
    if (!this.clearGridCommand) {
      this.clearGridCommand = reglInstance({
        frag: clearFrag,
        vert: updateVert,
        framebuffer: () => this.gridFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
      })
    }

    // Build grid command - positions each point at its grid cell
    // Uses gridOffset uniform for multiple pass support
    if (!this.buildGridCommand) {
      this.buildGridCommand = reglInstance({
        frag: buildGridFrag,
        vert: buildGridVert,
        framebuffer: () => this.gridFbo as regl.Framebuffer2D,
        primitive: 'points',
        count: () => data.pointsNumber ?? 0,
        attributes: {
          pointIndices: {
            buffer: this.pointIndices,
            size: 2,
          },
        },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          sizeTexture: () => this.sizeFbo,
          pointsTextureSize: () => store.pointsTextureSize,
          gridTextureSize: () => this.gridTextureSize,
          cellSize: () => this.cellSize,
          gridOffset: reglInstance.prop<{ gridOffset: [number, number] }, 'gridOffset'>('gridOffset'),
        },
        blend: {
          enable: true,
          func: {
            src: 'one',
            dst: 'one',
          },
          equation: {
            rgb: 'add',
            alpha: 'add',
          },
        },
        depth: { enable: false, mask: false },
        stencil: { enable: false },
      })
    }

    // Collision force command - uses the spatial hash grid
    if (!this.runCommand) {
      this.runCommand = reglInstance({
        frag: forceFrag,
        vert: updateVert,
        framebuffer: () => points?.velocityFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          sizeTexture: () => this.sizeFbo,
          gridTexture: () => this.gridFbo,
          pointsTextureSize: () => store.pointsTextureSize,
          gridTextureSize: () => this.gridTextureSize,
          cellSize: () => this.cellSize,
          spaceSize: () => store.adjustedSpaceSize,
          alpha: () => store.alpha,
          collisionStrength: () => config.simulationCollision,
          collisionRadius: () => config.simulationCollisionRadius ?? 0,
          pointsNumber: () => data.pointsNumber ?? 0,
          gridOffset: reglInstance.prop<{ gridOffset: [number, number] }, 'gridOffset'>('gridOffset'),
        },
        blend: {
          enable: true,
          func: {
            src: 'one',
            dst: 'one',
          },
          equation: {
            rgb: 'add',
            alpha: 'add',
          },
        },
        depth: { enable: false, mask: false },
        stencil: { enable: false },
      })
    }
  }

  public run (): void {
    // Run multiple passes with different grid offsets
    // This catches collisions that would be missed at cell boundaries
    for (const offset of GRID_OFFSETS) {
      // Step 1: Clear the grid
      this.clearGridCommand?.()

      // Step 2: Build the spatial hash grid with offset
      this.buildGridCommand?.({ gridOffset: offset })

      // Step 3: Calculate collision forces using the grid
      this.runCommand?.({ gridOffset: offset })
    }
  }
}
