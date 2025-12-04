import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import { forceFrag } from '@/graph/modules/ForceLink/force-spring'
import { createQuadBuffer } from '@/graph/modules/Shared/buffer'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export enum LinkDirection {
  OUTGOING = 'outgoing',
  INCOMING = 'incoming'
}

export class ForceLink extends CoreModule {
  private linkFirstIndicesAndAmountFbo: regl.Framebuffer2D | undefined
  private indicesFbo: regl.Framebuffer2D | undefined
  private biasAndStrengthFbo: regl.Framebuffer2D | undefined
  private randomDistanceFbo: regl.Framebuffer2D | undefined
  private linkFirstIndicesAndAmount: Float32Array = new Float32Array()
  private indices: Float32Array = new Float32Array()
  private maxPointDegree = 0
  private runCommand: regl.DrawCommand | undefined
  private linkFirstIndicesAndAmountTexture: regl.Texture2D | undefined
  private indicesTexture: regl.Texture2D | undefined
  private biasAndStrengthTexture: regl.Texture2D | undefined
  private randomDistanceTexture: regl.Texture2D | undefined

  public create (direction: LinkDirection): void {
    const { reglInstance, store: { pointsTextureSize, linksTextureSize }, data } = this
    if (!pointsTextureSize || !linksTextureSize) return
    this.linkFirstIndicesAndAmount = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
    this.indices = new Float32Array(linksTextureSize * linksTextureSize * 4)
    const linkBiasAndStrengthState = new Float32Array(linksTextureSize * linksTextureSize * 4)
    const linkDistanceState = new Float32Array(linksTextureSize * linksTextureSize * 4)

    const grouped = direction === LinkDirection.INCOMING ? data.sourceIndexToTargetIndices : data.targetIndexToSourceIndices
    this.maxPointDegree = 0
    let linkIndex = 0
    grouped?.forEach((connectedPointIndices, pointIndex) => {
      if (connectedPointIndices) {
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 0] = linkIndex % linksTextureSize
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 1] = Math.floor(linkIndex / linksTextureSize)
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 2] = connectedPointIndices.length ?? 0

        connectedPointIndices.forEach(([connectedPointIndex, initialLinkIndex]) => {
          this.indices[linkIndex * 4 + 0] = connectedPointIndex % pointsTextureSize
          this.indices[linkIndex * 4 + 1] = Math.floor(connectedPointIndex / pointsTextureSize)
          const degree = data.degree?.[connectedPointIndex] ?? 0
          const connectedDegree = data.degree?.[pointIndex] ?? 0
          const degreeSum = degree + connectedDegree
          // Prevent division by zero
          const bias = degreeSum !== 0 ? degree / degreeSum : 0.5
          const minDegree = Math.min(degree, connectedDegree)
          // Prevent division by zero
          let strength = data.linkStrength?.[initialLinkIndex] ?? (1 / Math.max(minDegree, 1))
          strength = Math.sqrt(strength)
          linkBiasAndStrengthState[linkIndex * 4 + 0] = bias
          linkBiasAndStrengthState[linkIndex * 4 + 1] = strength
          linkDistanceState[linkIndex * 4] = this.store.getRandomFloat(0, 1)

          linkIndex += 1
        })

        this.maxPointDegree = Math.max(this.maxPointDegree, connectedPointIndices.length ?? 0)
      }
    })

    if (!this.linkFirstIndicesAndAmountTexture) this.linkFirstIndicesAndAmountTexture = reglInstance.texture()
    this.linkFirstIndicesAndAmountTexture({
      data: this.linkFirstIndicesAndAmount,
      shape: [pointsTextureSize, pointsTextureSize, 4],
      type: 'float',
    })
    if (!this.linkFirstIndicesAndAmountFbo) this.linkFirstIndicesAndAmountFbo = reglInstance.framebuffer()
    this.linkFirstIndicesAndAmountFbo({
      color: this.linkFirstIndicesAndAmountTexture,
      depth: false,
      stencil: false,
    })

    if (!this.indicesTexture) this.indicesTexture = reglInstance.texture()
    this.indicesTexture({
      data: this.indices,
      shape: [linksTextureSize, linksTextureSize, 4],
      type: 'float',
    })
    if (!this.indicesFbo) this.indicesFbo = reglInstance.framebuffer()
    this.indicesFbo({
      color: this.indicesTexture,
      depth: false,
      stencil: false,
    })

    if (!this.biasAndStrengthTexture) this.biasAndStrengthTexture = reglInstance.texture()
    this.biasAndStrengthTexture({
      data: linkBiasAndStrengthState,
      shape: [linksTextureSize, linksTextureSize, 4],
      type: 'float',
    })
    if (!this.biasAndStrengthFbo) this.biasAndStrengthFbo = reglInstance.framebuffer()
    this.biasAndStrengthFbo({
      color: this.biasAndStrengthTexture,
      depth: false,
      stencil: false,
    })

    if (!this.randomDistanceTexture) this.randomDistanceTexture = reglInstance.texture()
    this.randomDistanceTexture({
      data: linkDistanceState,
      shape: [linksTextureSize, linksTextureSize, 4],
      type: 'float',
    })
    if (!this.randomDistanceFbo) this.randomDistanceFbo = reglInstance.framebuffer()
    this.randomDistanceFbo({
      color: this.randomDistanceTexture,
      depth: false,
      stencil: false,
    })
  }

  public initPrograms (): void {
    const { reglInstance, config, store, points } = this
    if (!this.runCommand) {
      this.runCommand = reglInstance({
        frag: () => forceFrag(this.maxPointDegree),
        vert: updateVert,
        framebuffer: () => points?.velocityFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          linkSpring: () => config.simulationLinkSpring,
          linkDistance: () => config.simulationLinkDistance,
          linkDistRandomVariationRange: () => config.simulationLinkDistRandomVariationRange,
          linkInfoTexture: () => this.linkFirstIndicesAndAmountFbo,
          linkIndicesTexture: () => this.indicesFbo,
          linkPropertiesTexture: () => this.biasAndStrengthFbo,
          linkRandomDistanceTexture: () => this.randomDistanceFbo,
          pointsTextureSize: () => store.pointsTextureSize,
          linksTextureSize: () => store.linksTextureSize,
          alpha: () => store.alpha,
        },
      })
    }
  }

  public run (): void {
    this.runCommand?.()
  }
}
