import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import calculateLevelFrag from '@/graph/modules/ForceManyBody/calculate-level.frag?raw'
import calculateLevelVert from '@/graph/modules/ForceManyBody/calculate-level.vert?raw'
import forceFrag from '@/graph/modules/ForceManyBody/force-level.frag?raw'
import forceCenterFrag from '@/graph/modules/ForceManyBody/force-centermass.frag?raw'
import { createIndexesForBuffer, createQuadBuffer } from '@/graph/modules/Shared/buffer'
import clearFrag from '@/graph/modules/Shared/clear.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class ForceManyBody extends CoreModule {
  private randomValuesFbo: regl.Framebuffer2D | undefined
  private levelsFbos = new Map<string, regl.Framebuffer2D>()
  private clearLevelsCommand: regl.DrawCommand | undefined
  private clearVelocityCommand: regl.DrawCommand | undefined
  private calculateLevelsCommand: regl.DrawCommand | undefined
  private forceCommand: regl.DrawCommand | undefined
  private forceFromItsOwnCentermassCommand: regl.DrawCommand | undefined
  private quadtreeLevels = 0
  private randomValuesTexture: regl.Texture2D | undefined
  private pointIndices: regl.Buffer | undefined

  public create (): void {
    const { reglInstance, store } = this
    if (!store.pointsTextureSize) return
    this.quadtreeLevels = Math.log2(store.adjustedSpaceSize)
    for (let i = 0; i < this.quadtreeLevels; i += 1) {
      const levelTextureSize = Math.pow(2, i + 1)
      if (!this.levelsFbos.has(`level[${i}]`)) {
        this.levelsFbos.set(`level[${i}]`, reglInstance.framebuffer())
      }
      const fbo = this.levelsFbos.get(`level[${i}]`)
      if (fbo) {
        fbo({
          shape: [levelTextureSize, levelTextureSize],
          colorType: 'float',
          depth: false,
          stencil: false,
        })
      }
    }
    // Create random number to prevent point to stick together in one coordinate
    const randomValuesState = new Float32Array(store.pointsTextureSize * store.pointsTextureSize * 4)
    for (let i = 0; i < store.pointsTextureSize * store.pointsTextureSize; ++i) {
      randomValuesState[i * 4] = store.getRandomFloat(-1, 1) * 0.00001
      randomValuesState[i * 4 + 1] = store.getRandomFloat(-1, 1) * 0.00001
    }

    if (!this.randomValuesTexture) this.randomValuesTexture = reglInstance.texture()
    this.randomValuesTexture({
      data: randomValuesState,
      shape: [store.pointsTextureSize, store.pointsTextureSize, 4],
      type: 'float',
    })
    if (!this.randomValuesFbo) this.randomValuesFbo = reglInstance.framebuffer()
    this.randomValuesFbo({
      color: this.randomValuesTexture,
      depth: false,
      stencil: false,
    })

    if (!this.pointIndices) this.pointIndices = reglInstance.buffer(0)
    this.pointIndices(createIndexesForBuffer(store.pointsTextureSize))
  }

  public initPrograms (): void {
    const { reglInstance, config, store, data, points } = this
    if (!this.clearLevelsCommand) {
      this.clearLevelsCommand = reglInstance({
        frag: clearFrag,
        vert: updateVert,
        framebuffer: (_: regl.DefaultContext, props: { levelFbo: regl.Framebuffer2D }) => props.levelFbo,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
      })
    }
    if (!this.calculateLevelsCommand) {
      this.calculateLevelsCommand = reglInstance({
        frag: calculateLevelFrag,
        vert: calculateLevelVert,
        framebuffer: (_: regl.DefaultContext, props: { levelFbo: regl.Framebuffer2D; levelTextureSize: number; cellSize: number }) => props.levelFbo,
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
          pointsTextureSize: () => store.pointsTextureSize,
          levelTextureSize: (_: regl.DefaultContext, props: { levelTextureSize: number }) => props.levelTextureSize,
          cellSize: (_: regl.DefaultContext, props: { cellSize: number }) => props.cellSize,
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

    if (!this.forceCommand) {
      this.forceCommand = reglInstance({
        frag: forceFrag,
        vert: updateVert,
        framebuffer: () => points?.velocityFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          level: (_, props: { levelFbo: regl.Framebuffer2D; levelTextureSize: number; level: number }) => props.level,
          levels: this.quadtreeLevels,
          levelFbo: (_, props) => props.levelFbo,
          levelTextureSize: (_, props) => props.levelTextureSize,
          alpha: () => store.alpha,
          repulsion: () => config.simulationRepulsion,
          spaceSize: () => store.adjustedSpaceSize,
          theta: () => config.simulationRepulsionTheta,
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

    if (!this.forceFromItsOwnCentermassCommand) {
      this.forceFromItsOwnCentermassCommand = reglInstance({
        frag: forceCenterFrag,
        vert: updateVert,
        framebuffer: () => points?.velocityFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          randomValues: () => this.randomValuesFbo,
          levelFbo: (_, props: { levelFbo: regl.Framebuffer2D; levelTextureSize: number }) => props.levelFbo,
          levelTextureSize: (_, props) => props.levelTextureSize,
          alpha: () => store.alpha,
          repulsion: () => config.simulationRepulsion,
          spaceSize: () => store.adjustedSpaceSize,
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

    if (!this.clearVelocityCommand) {
      this.clearVelocityCommand = reglInstance({
        frag: clearFrag,
        vert: updateVert,
        framebuffer: () => points?.velocityFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
      })
    }
  }

  public run (): void {
    const { store } = this
    for (let i = 0; i < this.quadtreeLevels; i += 1) {
      this.clearLevelsCommand?.({ levelFbo: this.levelsFbos.get(`level[${i}]`) })
      const levelTextureSize = Math.pow(2, i + 1)
      const cellSize = store.adjustedSpaceSize / levelTextureSize
      this.calculateLevelsCommand?.({
        levelFbo: this.levelsFbos.get(`level[${i}]`),
        levelTextureSize,
        cellSize,
      })
    }
    this.clearVelocityCommand?.()
    for (let i = 0; i < this.quadtreeLevels; i += 1) {
      const levelTextureSize = Math.pow(2, i + 1)
      this.forceCommand?.({
        levelFbo: this.levelsFbos.get(`level[${i}]`),
        levelTextureSize,
        level: i,
      })

      if (i === this.quadtreeLevels - 1) {
        this.forceFromItsOwnCentermassCommand?.({
          levelFbo: this.levelsFbos.get(`level[${i}]`),
          levelTextureSize,
          level: i,
        })
      }
    }
  }
}
