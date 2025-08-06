import { scaleLinear } from 'd3-scale'
import { mat3 } from 'gl-matrix'
import { Random } from 'random'
import { getRgbaColor, rgbToBrightness } from '@/graph/helper'
import { hoveredPointRingOpacity, focusedPointRingOpacity, defaultConfigValues } from '@/graph/variables'

export const ALPHA_MIN = 0.001
export const MAX_POINT_SIZE = 64

export type Hovered = { index: number; position: [ number, number ] }
type Focused = { index: number }

export class Store {
  public pointsTextureSize = 0
  public linksTextureSize = 0
  public alpha = 1
  public transform = mat3.create()
  public screenSize: [number, number] = [0, 0]
  public mousePosition = [0, 0]
  public screenMousePosition = [0, 0]
  public selectedArea = [[0, 0], [0, 0]]
  public isSimulationRunning = false
  public simulationProgress = 0
  public selectedIndices: Float32Array | null = null
  public maxPointSize = MAX_POINT_SIZE
  public hoveredPoint: Hovered | undefined = undefined
  public focusedPoint: Focused | undefined = undefined
  public draggingPointIndex: number | undefined = undefined
  public hoveredLinkIndex: number | undefined = undefined
  public adjustedSpaceSize = defaultConfigValues.spaceSize
  public isSpaceKeyPressed = false
  public div: HTMLDivElement | undefined
  public webglMaxTextureSize = 16384 // Default fallback value

  public hoveredPointRingColor = [1, 1, 1, hoveredPointRingOpacity]
  public focusedPointRingColor = [1, 1, 1, focusedPointRingOpacity]
  // -1 means that the color is not set
  public greyoutPointColor = [-1, -1, -1, -1]
  // If backgroundColor is dark, isDarkenGreyout is true
  public isDarkenGreyout = false
  private alphaTarget = 0
  private scalePointX = scaleLinear()
  private scalePointY = scaleLinear()
  private random = new Random()
  private _backgroundColor: [number, number, number, number] = [0, 0, 0, 0]

  public get backgroundColor (): [number, number, number, number] {
    return this._backgroundColor
  }

  public set backgroundColor (color: [number, number, number, number]) {
    this._backgroundColor = color
    const brightness = rgbToBrightness(color[0], color[1], color[2])
    document.documentElement.style.setProperty('--cosmosgl-attribution-color', brightness > 0.65 ? 'black' : 'white')
    document.documentElement.style.setProperty('--cosmosgl-error-message-color', brightness > 0.65 ? 'black' : 'white')
    if (this.div) this.div.style.backgroundColor = `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3]})`

    this.isDarkenGreyout = brightness < 0.65
  }

  public addRandomSeed (seed: number | string): void {
    this.random = this.random.clone(seed)
  }

  public getRandomFloat (min: number, max: number): number {
    return this.random.float(min, max)
  }

  /**
   * If the config parameter `spaceSize` exceeds the limits of WebGL,
   * it reduces the space size without changing the config parameter.
   */
  public adjustSpaceSize (configSpaceSize: number, webglMaxTextureSize: number): void {
    if (configSpaceSize >= webglMaxTextureSize) {
      this.adjustedSpaceSize = webglMaxTextureSize / 2
      console.warn(`The \`spaceSize\` has been reduced to ${this.adjustedSpaceSize} due to WebGL limits`)
    } else this.adjustedSpaceSize = configSpaceSize
  }

  /**
   * Sets the WebGL texture size limit for use in atlas creation and other texture operations.
   */
  public setWebGLMaxTextureSize (webglMaxTextureSize: number): void {
    this.webglMaxTextureSize = webglMaxTextureSize
  }

  public updateScreenSize (width: number, height: number): void {
    const { adjustedSpaceSize } = this
    this.screenSize = [width, height]
    this.scalePointX
      .domain([0, adjustedSpaceSize])
      .range([(width - adjustedSpaceSize) / 2, (width + adjustedSpaceSize) / 2])
    this.scalePointY
      .domain([adjustedSpaceSize, 0])
      .range([(height - adjustedSpaceSize) / 2, (height + adjustedSpaceSize) / 2])
  }

  public scaleX (x: number): number {
    return this.scalePointX(x)
  }

  public scaleY (y: number): number {
    return this.scalePointY(y)
  }

  public setHoveredPointRingColor (color: string): void {
    const convertedRgba = getRgbaColor(color)
    this.hoveredPointRingColor[0] = convertedRgba[0]
    this.hoveredPointRingColor[1] = convertedRgba[1]
    this.hoveredPointRingColor[2] = convertedRgba[2]
  }

  public setFocusedPointRingColor (color: string): void {
    const convertedRgba = getRgbaColor(color)
    this.focusedPointRingColor[0] = convertedRgba[0]
    this.focusedPointRingColor[1] = convertedRgba[1]
    this.focusedPointRingColor[2] = convertedRgba[2]
  }

  public setGreyoutPointColor (color: string | [number, number, number, number] | undefined): void {
    if (color === undefined) {
      this.greyoutPointColor = [-1, -1, -1, -1]
      return
    }
    const convertedRgba = getRgbaColor(color)
    this.greyoutPointColor[0] = convertedRgba[0]
    this.greyoutPointColor[1] = convertedRgba[1]
    this.greyoutPointColor[2] = convertedRgba[2]
    this.greyoutPointColor[3] = convertedRgba[3]
  }

  public setFocusedPoint (index?: number): void {
    if (index !== undefined) {
      this.focusedPoint = { index }
    } else this.focusedPoint = undefined
  }

  public addAlpha (decay: number): number {
    return (this.alphaTarget - this.alpha) * this.alphaDecay(decay)
  }

  private alphaDecay = (decay: number): number => 1 - Math.pow(ALPHA_MIN, 1 / decay)
}
