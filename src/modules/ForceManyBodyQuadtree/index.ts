import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import calculateLevelFrag from '@/graph/modules/ForceManyBody/calculate-level.frag?raw'
import calculateLevelVert from '@/graph/modules/ForceManyBody/calculate-level.vert?raw'
import { forceFrag } from '@/graph/modules/ForceManyBody/quadtree-frag-shader'
import { createIndexesForBuffer, createQuadBuffer } from '@/graph/modules/Shared/buffer'
import clearFrag from '@/graph/modules/Shared/clear.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class ForceManyBodyQuadtree extends CoreModule {
  private randomValuesFbo: regl.Framebuffer2D | undefined
  private levelsTextures = new Map<string, regl.Texture2D>()
  private levelsFbos = new Map<string, regl.Framebuffer2D>()
  private clearLevelsCommand: regl.DrawCommand | undefined
  private calculateLevelsCommand: regl.DrawCommand | undefined
  private quadtreeCommand: regl.DrawCommand | undefined
  private quadtreeLevels = 0
  private randomValuesTexture: regl.Texture2D | undefined
  private pointIndices: regl.Buffer | undefined

  public create (): void {
    const { reglInstance, store } = this
    if (!store.pointsTextureSize) return
    this.quadtreeLevels = Math.log2(store.adjustedSpaceSize)
    for (let i = 0; i < this.quadtreeLevels; i += 1) {
      const levelTextureSize = Math.pow(2, i + 1)
      const levelKey = `level[${i}]`
      if (!this.levelsTextures.has(levelKey)) {
        this.levelsTextures.set(levelKey, reglInstance.texture())
      }
      const texture = this.levelsTextures.get(levelKey)
      if (texture) {
        texture({
          data: new Float32Array(levelTextureSize * levelTextureSize * 4),
          shape: [levelTextureSize, levelTextureSize, 4],
          type: 'float',
        })
      }
      if (!this.levelsFbos.has(levelKey)) {
        this.levelsFbos.set(levelKey, reglInstance.framebuffer())
      }
      const fbo = this.levelsFbos.get(levelKey)
      if (fbo) {
        fbo({
          color: this.levelsTextures.get(levelKey),
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

    this.quadtreeCommand = reglInstance({
      frag: forceFrag(config.simulationRepulsionQuadtreeLevels ?? this.quadtreeLevels, this.quadtreeLevels),
      vert: updateVert,
      framebuffer: () => points?.velocityFbo as regl.Framebuffer2D,
      primitive: 'triangle strip',
      count: 4,
      attributes: { vertexCoord: createQuadBuffer(reglInstance) },
      uniforms: {
        positionsTexture: () => points?.previousPositionFbo,
        randomValues: () => this.randomValuesFbo,
        spaceSize: () => store.adjustedSpaceSize,
        repulsion: () => config.simulationRepulsion,
        theta: () => config.simulationRepulsionTheta,
        alpha: () => store.alpha,
        ...Object.fromEntries(this.levelsFbos),
      },
    })
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
    this.quadtreeCommand?.()
  }
}
