import { getRgbaColor, isNumber } from '@/graph/helper'
import { type GraphConfigInterface } from '@/graph/config'
import { defaultConfigValues } from '@/graph/variables'

export enum PointShape {
  Circle = 0,
  Square = 1,
  Triangle = 2,
  Diamond = 3,
  Pentagon = 4,
  Hexagon = 5,
  Star = 6,
  Cross = 7,
  None = 8
}

export class GraphData {
  public inputPointPositions: Float32Array | undefined
  public inputImageData: ImageData[] | undefined
  public inputPinnedPoints: number[] | undefined

  public pointPositions: Float32Array | undefined
  /**
   * Number of points before the latest data update.
   * Used as the `from` value for point transitions.
   * This lets transitions handle added or removed points correctly.
   */
  public sourcePointsNumber = 0
  /**
   * Number of points after the latest data update.
   * Used as the `to` value for point transitions.
   * This lets transitions handle added or removed points correctly.
   */
  public targetPointsNumber = 0
  public pointColors: Float32Array | undefined
  public pointSizes: Float32Array | undefined
  public pointShapes: Float32Array | undefined
  public pointImageIndices: Float32Array | undefined
  public pointImageSizes: Float32Array | undefined

  public links: Float32Array | undefined
  public linkColors: Float32Array | undefined
  public linkWidths: Float32Array | undefined
  public linkArrows: number[] | undefined
  public linkStrength: Float32Array | undefined

  public pointClusters: (number | undefined)[] | undefined
  public clusterPositions: (number | undefined)[] | undefined
  public clusterStrength: Float32Array | undefined

  /**
   * Each inner array of `sourceIndexToTargetIndices` and `targetIndexToSourceIndices` contains pairs where:
   *   - The first value is the target/source index in the point array.
   *   - The second value is the link index in the array of links.
  */
  public sourceIndexToTargetIndices: ([number, number][] | undefined)[] | undefined
  public targetIndexToSourceIndices: ([number, number][] | undefined)[] | undefined

  public degree: number[] | undefined
  public inDegree: number[] | undefined
  public outDegree: number[] | undefined
  private _config: GraphConfigInterface

  // Input channels sit behind accessors so every assignment marks the channel
  // dirty and update() can skip revalidating data that did not change.
  private _inputPointColors: Float32Array | undefined
  private _inputPointSizes: Float32Array | undefined
  private _inputPointShapes: Float32Array | undefined
  private _inputPointImageIndices: Float32Array | undefined
  private _inputPointImageSizes: Float32Array | undefined
  private _inputLinks: Float32Array | undefined
  private _inputLinkColors: Float32Array | undefined
  private _inputLinkWidths: Float32Array | undefined
  private _linkArrowsBoolean: boolean[] | undefined
  private _inputLinkStrength: Float32Array | undefined
  private _inputPointClusters: (number | undefined)[] | undefined
  private _inputClusterPositions: (number | undefined)[] | undefined
  private _inputClusterStrength: Float32Array | undefined

  // Dirty flags start true so the first update() processes every channel.
  private _arePointColorsDirty = true
  private _arePointSizesDirty = true
  private _arePointShapesDirty = true
  private _arePointImageIndicesDirty = true
  private _arePointImageSizesDirty = true
  private _areLinksDirty = true
  private _areLinkColorsDirty = true
  private _areLinkWidthsDirty = true
  private _areLinkArrowsDirty = true
  private _isLinkStrengthDirty = true
  private _areClustersDirty = true

  public constructor (config: GraphConfigInterface) {
    this._config = config
  }

  public get pointsNumber (): number | undefined {
    return this.pointPositions && this.pointPositions.length / 2
  }

  public get linksNumber (): number | undefined {
    return this.links && this.links.length / 2
  }

  public get inputPointColors (): Float32Array | undefined { return this._inputPointColors }
  public get inputPointSizes (): Float32Array | undefined { return this._inputPointSizes }
  public get inputPointShapes (): Float32Array | undefined { return this._inputPointShapes }
  public get inputPointImageIndices (): Float32Array | undefined { return this._inputPointImageIndices }
  public get inputPointImageSizes (): Float32Array | undefined { return this._inputPointImageSizes }
  public get inputLinks (): Float32Array | undefined { return this._inputLinks }
  public get inputLinkColors (): Float32Array | undefined { return this._inputLinkColors }
  public get inputLinkWidths (): Float32Array | undefined { return this._inputLinkWidths }
  public get linkArrowsBoolean (): boolean[] | undefined { return this._linkArrowsBoolean }
  public get inputLinkStrength (): Float32Array | undefined { return this._inputLinkStrength }
  public get inputPointClusters (): (number | undefined)[] | undefined { return this._inputPointClusters }
  public get inputClusterPositions (): (number | undefined)[] | undefined { return this._inputClusterPositions }
  public get inputClusterStrength (): Float32Array | undefined { return this._inputClusterStrength }

  public set inputPointColors (value: Float32Array | undefined) {
    this._inputPointColors = value
    this._arePointColorsDirty = true
  }

  public set inputPointSizes (value: Float32Array | undefined) {
    this._inputPointSizes = value
    this._arePointSizesDirty = true
  }

  public set inputPointShapes (value: Float32Array | undefined) {
    this._inputPointShapes = value
    this._arePointShapesDirty = true
  }

  public set inputPointImageIndices (value: Float32Array | undefined) {
    this._inputPointImageIndices = value
    this._arePointImageIndicesDirty = true
  }

  public set inputPointImageSizes (value: Float32Array | undefined) {
    this._inputPointImageSizes = value
    this._arePointImageSizesDirty = true
  }

  public set inputLinks (value: Float32Array | undefined) {
    this._inputLinks = value
    this._areLinksDirty = true
  }

  public set inputLinkColors (value: Float32Array | undefined) {
    this._inputLinkColors = value
    this._areLinkColorsDirty = true
  }

  public set inputLinkWidths (value: Float32Array | undefined) {
    this._inputLinkWidths = value
    this._areLinkWidthsDirty = true
  }

  public set linkArrowsBoolean (value: boolean[] | undefined) {
    this._linkArrowsBoolean = value
    this._areLinkArrowsDirty = true
  }

  public set inputLinkStrength (value: Float32Array | undefined) {
    this._inputLinkStrength = value
    this._isLinkStrengthDirty = true
  }

  public set inputPointClusters (value: (number | undefined)[] | undefined) {
    this._inputPointClusters = value
    this._areClustersDirty = true
  }

  public set inputClusterPositions (value: (number | undefined)[] | undefined) {
    this._inputClusterPositions = value
    this._areClustersDirty = true
  }

  public set inputClusterStrength (value: Float32Array | undefined) {
    this._inputClusterStrength = value
    this._areClustersDirty = true
  }

  public updatePoints (): void {
    // Don't sync the same positions twice — it breaks animations when points are added or removed.
    if (this.pointPositions === this.inputPointPositions) return

    this.sourcePointsNumber = this.pointPositions ? this.pointPositions.length / 2 : 0
    this.pointPositions = this.inputPointPositions
    this.targetPointsNumber = this.pointPositions ? this.pointPositions.length / 2 : 0
  }

  /**
   * Updates the point colors based on the input data or default config value.
   */
  public updatePointColor (): void {
    if (this.pointsNumber === undefined) {
      this.pointColors = undefined
      return
    }

    // Sets point colors to default values from config if the input is missing or does not match input points number.
    const defaultRgba = getRgbaColor(this._config.pointDefaultColor)
    if (this.inputPointColors === undefined || this.inputPointColors.length / 4 !== this.pointsNumber) {
      this.pointColors = new Float32Array(this.pointsNumber * 4)
      for (let i = 0; i < this.pointColors.length / 4; i++) {
        this.pointColors[i * 4] = defaultRgba[0]
        this.pointColors[i * 4 + 1] = defaultRgba[1]
        this.pointColors[i * 4 + 2] = defaultRgba[2]
        this.pointColors[i * 4 + 3] = defaultRgba[3]
      }
    } else {
      this.pointColors = this.inputPointColors
      for (let i = 0; i < this.pointColors.length / 4; i++) {
        if (!isNumber(this.pointColors[i * 4])) this.pointColors[i * 4] = defaultRgba[0]
        if (!isNumber(this.pointColors[i * 4 + 1])) this.pointColors[i * 4 + 1] = defaultRgba[1]
        if (!isNumber(this.pointColors[i * 4 + 2])) this.pointColors[i * 4 + 2] = defaultRgba[2]
        if (!isNumber(this.pointColors[i * 4 + 3])) this.pointColors[i * 4 + 3] = defaultRgba[3]
      }
    }
  }

  /**
   * Updates the point sizes based on the input data or default config value.
   */
  public updatePointSize (): void {
    if (this.pointsNumber === undefined) {
      this.pointSizes = undefined
      return
    }

    // Sets point sizes to default values from config if the input is missing or does not match input points number.
    const defaultSize = this._config.pointDefaultSize
    if (this.inputPointSizes === undefined || this.inputPointSizes.length !== this.pointsNumber) {
      this.pointSizes = new Float32Array(this.pointsNumber).fill(defaultSize)
    } else {
      this.pointSizes = this.inputPointSizes
      for (let i = 0; i < this.pointSizes.length; i++) {
        if (!isNumber(this.pointSizes[i])) {
          this.pointSizes[i] = defaultSize
        }
      }
    }
  }

  /**
   * Updates the point shapes based on the input data or default config value.
   * Images are rendered above shapes.
   */
  public updatePointShape (): void {
    if (this.pointsNumber === undefined) {
      this.pointShapes = undefined
      return
    }

    const { pointDefaultShape } = this._config
    const configShape = typeof pointDefaultShape === 'string' ? Number(pointDefaultShape) : pointDefaultShape
    const defaultShape = (configShape >= 0 && configShape <= 8) ? configShape : defaultConfigValues.pointDefaultShape

    // Sets point shapes to default values if the input is missing or does not match input points number.
    if (this.inputPointShapes === undefined || this.inputPointShapes.length !== this.pointsNumber) {
      this.pointShapes = new Float32Array(this.pointsNumber).fill(defaultShape)
    } else {
      this.pointShapes = new Float32Array(this.inputPointShapes)
      const pointShapes = this.pointShapes
      for (let i = 0; i < pointShapes.length; i++) {
        const shape = pointShapes[i]
        if (shape == null || !isNumber(shape) || shape < 0 || shape > 8) {
          pointShapes[i] = defaultShape
        }
      }
    }
  }

  /**
   * Updates the point image indices based on the input data or default value (-1 for no image).
   */
  public updatePointImageIndices (): void {
    if (this.pointsNumber === undefined) {
      this.pointImageIndices = undefined
      return
    }

    // Sets point image indices to -1 if input is missing or doesn't match points count
    if (this.inputPointImageIndices === undefined || this.inputPointImageIndices.length !== this.pointsNumber) {
      this.pointImageIndices = new Float32Array(this.pointsNumber).fill(-1)
    } else {
      const pointImageIndices = new Float32Array(this.inputPointImageIndices)
      for (let i = 0; i < pointImageIndices.length; i++) {
        const rawIndex = pointImageIndices[i]
        const imageIndex = (rawIndex === undefined) ? NaN : rawIndex
        if (!Number.isFinite(imageIndex) || imageIndex < 0) {
          pointImageIndices[i] = -1
        } else {
          pointImageIndices[i] = Math.trunc(imageIndex)
        }
      }
      this.pointImageIndices = pointImageIndices
    }
  }

  /**
   * Updates the point image sizes based on the input data or default to point sizes.
   */
  public updatePointImageSizes (): void {
    if (this.pointsNumber === undefined) {
      this.pointImageSizes = undefined
      return
    }

    // Sets point image sizes to point sizes if the input is missing or does not match input points number.
    const defaultSize = this._config.pointDefaultSize
    if (this.inputPointImageSizes === undefined || this.inputPointImageSizes.length !== this.pointsNumber) {
      this.pointImageSizes = this.pointSizes ? new Float32Array(this.pointSizes) : new Float32Array(this.pointsNumber).fill(defaultSize)
    } else {
      this.pointImageSizes = new Float32Array(this.inputPointImageSizes)
      for (let i = 0; i < this.pointImageSizes.length; i++) {
        if (!isNumber(this.pointImageSizes[i])) {
          this.pointImageSizes[i] = this.pointSizes?.[i] ?? defaultSize
        }
      }
    }
  }

  public updateLinks (): void {
    const input = this.inputLinks
    const pointsNumber = this.pointsNumber
    if (input === undefined || pointsNumber === undefined) {
      this.links = input
      return
    }

    // Drop links whose endpoints are not valid point indices — out-of-range or
    // non-integer values silently corrupt the adjacency lists, cause out-of-bounds
    // writes in the link force, and reach the GPU as garbage texture coordinates.
    const inputLinksNumber = Math.floor(input.length / 2)
    let validLinksNumber = 0
    for (let i = 0; i < inputLinksNumber; i++) {
      if (this._isValidLink(input[i * 2], input[i * 2 + 1], pointsNumber)) validLinksNumber += 1
    }

    if (validLinksNumber === inputLinksNumber && input.length % 2 === 0) {
      this.links = input
      return
    }

    if (input.length % 2 !== 0) {
      console.warn('cosmos.gl: The links array has an odd length; the trailing value was ignored')
    }
    if (validLinksNumber !== inputLinksNumber) {
      console.warn(
        `cosmos.gl: Dropped ${inputLinksNumber - validLinksNumber} of ${inputLinksNumber} links ` +
        `whose endpoints are not valid point indices (expected integers in [0, ${pointsNumber}))`
      )
    }

    const links = new Float32Array(validLinksNumber * 2)
    let j = 0
    for (let i = 0; i < inputLinksNumber; i++) {
      const source = input[i * 2]
      const target = input[i * 2 + 1]
      if (this._isValidLink(source, target, pointsNumber)) {
        links[j] = source as number
        links[j + 1] = target as number
        j += 2
      }
    }
    this.links = links
  }

  /**
   * Updates the link colors based on the input data or default config value.
   */
  public updateLinkColor (): void {
    if (this.linksNumber === undefined) {
      this.linkColors = undefined
      return
    }

    // Sets link colors to default values from config if the input is missing or does not match input links number.
    const defaultRgba = getRgbaColor(this._config.linkDefaultColor)
    if (this.inputLinkColors === undefined || this.inputLinkColors.length / 4 !== this.linksNumber) {
      this.linkColors = new Float32Array(this.linksNumber * 4)

      for (let i = 0; i < this.linkColors.length / 4; i++) {
        this.linkColors[i * 4] = defaultRgba[0]
        this.linkColors[i * 4 + 1] = defaultRgba[1]
        this.linkColors[i * 4 + 2] = defaultRgba[2]
        this.linkColors[i * 4 + 3] = defaultRgba[3]
      }
    } else {
      this.linkColors = this.inputLinkColors
      for (let i = 0; i < this.linkColors.length / 4; i++) {
        if (!isNumber(this.linkColors[i * 4])) this.linkColors[i * 4] = defaultRgba[0]
        if (!isNumber(this.linkColors[i * 4 + 1])) this.linkColors[i * 4 + 1] = defaultRgba[1]
        if (!isNumber(this.linkColors[i * 4 + 2])) this.linkColors[i * 4 + 2] = defaultRgba[2]
        if (!isNumber(this.linkColors[i * 4 + 3])) this.linkColors[i * 4 + 3] = defaultRgba[3]
      }
    }
  }

  /**
   * Updates the link width based on the input data or default config value.
   */
  public updateLinkWidth (): void {
    if (this.linksNumber === undefined) {
      this.linkWidths = undefined
      return
    }

    // Sets link widths to default values from config if the input is missing or does not match input links number.
    const defaultWidth = this._config.linkDefaultWidth
    if (this.inputLinkWidths === undefined || this.inputLinkWidths.length !== this.linksNumber) {
      this.linkWidths = new Float32Array(this.linksNumber).fill(defaultWidth)
    } else {
      this.linkWidths = this.inputLinkWidths
      for (let i = 0; i < this.linkWidths.length; i++) {
        if (!isNumber(this.linkWidths[i])) {
          this.linkWidths[i] = defaultWidth
        }
      }
    }
  }

  /**
   * Updates the link arrows based on the input data or default config value.
   */
  public updateArrows (): void {
    if (this.linksNumber === undefined) {
      this.linkArrows = undefined
      return
    }

    // Sets link arrows to default values from config if the input is missing or does not match input links number.
    const defaultArrows = this._config.linkDefaultArrows
    if (this.linkArrowsBoolean === undefined || this.linkArrowsBoolean.length !== this.linksNumber) {
      this.linkArrows = new Array(this.linksNumber).fill(+defaultArrows)
    } else {
      this.linkArrows = this.linkArrowsBoolean.map(d => +d)
    }
  }

  public updateLinkStrength (): void {
    if (this.linksNumber === undefined) {
      this.linkStrength = undefined
    }

    if (this.inputLinkStrength === undefined || this.inputLinkStrength.length !== this.linksNumber) {
      this.linkStrength = undefined
    } else {
      this.linkStrength = this.inputLinkStrength
    }
  }

  public updateClusters (): void {
    if (this.pointsNumber === undefined) {
      this.pointClusters = undefined
      this.clusterPositions = undefined
      return
    }
    if (this.inputPointClusters === undefined || this.inputPointClusters.length !== this.pointsNumber) {
      this.pointClusters = undefined
    } else {
      this.pointClusters = this.inputPointClusters
    }
    if (this.inputClusterPositions === undefined) {
      this.clusterPositions = undefined
    } else {
      this.clusterPositions = this.inputClusterPositions
    }
    if (this.inputClusterStrength === undefined || this.inputClusterStrength.length !== this.pointsNumber) {
      this.clusterStrength = undefined
    } else {
      this.clusterStrength = this.inputClusterStrength
    }
  }

  /**
   * Applies pending input changes. Channels whose input was not re-assigned
   * since the last update are skipped — revalidating every channel and
   * rebuilding the adjacency lists on every render() is O(points + links) of
   * CPU work and allocation that is wasted when nothing changed.
   */
  public update (): void {
    // Mirrors the reference guard inside updatePoints(): a new positions array
    // changes the point count every derived channel is validated against.
    const pointsChanged = this.pointPositions !== this.inputPointPositions
    // Link validation depends on the point count, so links (and everything
    // derived from them) are also refreshed when the positions change.
    const linksChanged = this._areLinksDirty || pointsChanged

    this.updatePoints()

    if (pointsChanged || this._arePointColorsDirty) this.updatePointColor()
    if (pointsChanged || this._arePointSizesDirty) this.updatePointSize()
    if (pointsChanged || this._arePointShapesDirty) this.updatePointShape()
    if (pointsChanged || this._arePointImageIndicesDirty) this.updatePointImageIndices()
    // Image sizes fall back to a copy of point sizes when not provided,
    // so they depend on the sizes channel as well.
    if (pointsChanged || this._arePointImageSizesDirty || this._arePointSizesDirty) this.updatePointImageSizes()

    if (linksChanged) this.updateLinks()
    if (linksChanged || this._areLinkColorsDirty) this.updateLinkColor()
    if (linksChanged || this._areLinkWidthsDirty) this.updateLinkWidth()
    if (linksChanged || this._areLinkArrowsDirty) this.updateArrows()
    if (linksChanged || this._isLinkStrengthDirty) this.updateLinkStrength()

    if (pointsChanged || this._areClustersDirty) this.updateClusters()

    if (linksChanged) {
      this._createAdjacencyLists()
      this._calculateDegrees()
    }

    this._arePointColorsDirty = false
    this._arePointSizesDirty = false
    this._arePointShapesDirty = false
    this._arePointImageIndicesDirty = false
    this._arePointImageSizesDirty = false
    this._areLinksDirty = false
    this._areLinkColorsDirty = false
    this._areLinkWidthsDirty = false
    this._areLinkArrowsDirty = false
    this._isLinkStrengthDirty = false
    this._areClustersDirty = false
  }

  /**
   * Returns unique point indices that are neighbors of the given point(s) —
   * i.e., connected by a link in either direction.
   * @param pointIndices - A single point index or an array of point indices.
   * @returns Array of neighboring point indices.
   */
  public getNeighboringPointIndices (pointIndices: number | number[]): number[] {
    const indices = Array.isArray(pointIndices) ? pointIndices : [pointIndices]
    const pointsNumber = this.pointsNumber ?? 0
    const result = new Set<number>()
    for (const index of indices) {
      if (index < 0 || index >= pointsNumber) continue
      for (const [pointIndex] of this.sourceIndexToTargetIndices?.[index] ?? []) result.add(pointIndex)
      for (const [pointIndex] of this.targetIndexToSourceIndices?.[index] ?? []) result.add(pointIndex)
    }
    return [...result]
  }

  /**
   * Returns unique link indices where both the source and target endpoints
   * are within the given point(s). Only links fully contained in the set are returned.
   * @param pointIndices - A single point index or an array of point indices.
   * @returns Array of link indices connecting points within the provided set.
   */
  public getConnectedLinkIndices (pointIndices: number | number[]): number[] {
    const indices = Array.isArray(pointIndices) ? pointIndices : [pointIndices]
    const pointsNumber = this.pointsNumber ?? 0
    const indexSet = new Set(indices)
    const result = new Set<number>()
    for (const index of indexSet) {
      if (index < 0 || index >= pointsNumber) continue
      for (const [targetIndex, linkIndex] of this.sourceIndexToTargetIndices?.[index] ?? []) {
        if (indexSet.has(targetIndex)) result.add(linkIndex)
      }
    }
    return [...result]
  }

  /**
   * Returns unique point indices at the endpoints (source and target) of the given link(s).
   * @param linkIndices - A single link index or an array of link indices.
   * @returns Array of point indices at the ends of the provided links.
   */
  public getConnectedPointIndices (linkIndices: number | number[]): number[] {
    const indices = Array.isArray(linkIndices) ? linkIndices : [linkIndices]
    const result = new Set<number>()
    if (this.links === undefined) return []
    const linksNumber = this.linksNumber ?? 0
    for (const linkIndex of indices) {
      if (linkIndex < 0 || linkIndex >= linksNumber) continue
      const sourceIndex = this.links[linkIndex * 2]
      const targetIndex = this.links[linkIndex * 2 + 1]
      if (sourceIndex !== undefined) result.add(sourceIndex)
      if (targetIndex !== undefined) result.add(targetIndex)
    }
    return [...result]
  }

  private _createAdjacencyLists (): void {
    if (this.linksNumber === undefined || this.links === undefined) {
      this.sourceIndexToTargetIndices = undefined
      this.targetIndexToSourceIndices = undefined
      return
    }

    this.sourceIndexToTargetIndices = new Array(this.pointsNumber).fill(undefined)
    this.targetIndexToSourceIndices = new Array(this.pointsNumber).fill(undefined)
    for (let i = 0; i < this.linksNumber; i++) {
      const sourceIndex = this.links[i * 2]
      const targetIndex = this.links[i * 2 + 1]
      if (sourceIndex !== undefined && targetIndex !== undefined) {
        if (this.sourceIndexToTargetIndices[sourceIndex] === undefined) this.sourceIndexToTargetIndices[sourceIndex] = []
        this.sourceIndexToTargetIndices[sourceIndex]?.push([targetIndex, i])

        if (this.targetIndexToSourceIndices[targetIndex] === undefined) this.targetIndexToSourceIndices[targetIndex] = []
        this.targetIndexToSourceIndices[targetIndex]?.push([sourceIndex, i])
      }
    }
  }

  private _isValidLink (source: number | undefined, target: number | undefined, pointsNumber: number): boolean {
    return source !== undefined && target !== undefined &&
      Number.isInteger(source) && Number.isInteger(target) &&
      source >= 0 && source < pointsNumber &&
      target >= 0 && target < pointsNumber
  }

  private _calculateDegrees (): void {
    if (this.pointsNumber === undefined) {
      this.degree = undefined
      this.inDegree = undefined
      this.outDegree = undefined
      return
    }

    this.degree = new Array(this.pointsNumber).fill(0)
    this.inDegree = new Array(this.pointsNumber).fill(0)
    this.outDegree = new Array(this.pointsNumber).fill(0)

    for (let i = 0; i < this.pointsNumber; i++) {
      this.inDegree[i] = this.targetIndexToSourceIndices?.[i]?.length ?? 0
      this.outDegree[i] = this.sourceIndexToTargetIndices?.[i]?.length ?? 0
      this.degree[i] = (this.inDegree[i] ?? 0) + (this.outDegree[i] ?? 0)
    }
  }
}
