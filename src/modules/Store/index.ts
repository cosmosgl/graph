import { scaleLinear } from 'd3-scale'
import { mat3 } from 'gl-matrix'
import { Random } from 'random'
import { getRgbaColor, rgbToBrightness } from '@/graph/helper'
import { hoveredPointRingOpacity, focusedPointRingOpacity, defaultConfigValues } from '@/graph/variables'
import type { GraphConfigInterface } from '@/graph/config'

export const ALPHA_MIN = 0.001
export const MAX_POINT_SIZE = 64

/**
 * Maximum number of executions to delay before performing hover detection.
 * This threshold prevents excessive hover detection calls for performance optimization.
 * The `findHoveredItem` method will skip actual detection until this count is reached.
 */
export const MAX_HOVER_DETECTION_DELAY = 4

/**
 * Minimum mouse movement threshold (in pixels) to trigger hover detection.
 * If the mouse moves less than this distance, hover detection will be skipped to save performance.
 */
export const MIN_MOUSE_MOVEMENT_THRESHOLD = 2

export type Hovered = { index: number; position: [ number, number ] }
type Focused = { index: number }

/**
 * Type alias for a 4x4 matrix stored as a 16-element array in column-major order.
 * Used for std140 uniform buffer layout compatibility.
 */
export type Mat4Array = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]

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
  public hoveredLinkColor = [-1, -1, -1, -1]
  // -1 means that the color is not set
  public greyoutPointColor = [-1, -1, -1, -1]
  // If backgroundColor is dark, isDarkenGreyout is true
  public isDarkenGreyout = false
  // Whether link hovering is enabled based on configured event handlers
  public isLinkHoveringEnabled = false
  private alphaTarget = 0
  private scalePointX = scaleLinear()
  private scalePointY = scaleLinear()
  private random = new Random()
  private _backgroundColor: [number, number, number, number] = [0, 0, 0, 0]

  public get backgroundColor (): [number, number, number, number] {
    return this._backgroundColor
  }

  /**
   * Gets the transformation matrix as a 4x4 matrix for std140 uniform buffer layout.
   *
   * This method converts the internal 3x3 transformation matrix (mat3) to a 4x4 matrix format
   * required by WebGPU uniform buffers using the std140 layout standard.
   *
   * ## Matrix Storage Format
   *
   * Matrices are stored in **column-major order** (GLSL convention). The internal `transform`
   * array is a 9-element array representing a 3x3 matrix:
   *
   * ```
   * [m00, m10, m20, m01, m11, m21, m02, m12, m22]
   * ```
   *
   * Which represents the matrix:
   * ```
   * [m00 m01 m02]
   * [m10 m11 m12]
   * [m20 m21 m22]
   * ```
   *
   * ## Why This Conversion Is Needed
   *
   * The internal `transform` property stores a 3x3 matrix (9 elements) which is sufficient for
   * 2D transformations (translation, rotation, scaling in x/y plane). However, when passing
   * transformation matrices to GPU shaders via uniform buffers, we must comply with the std140
   * layout standard.
   *
   * ### std140 Layout Requirements
   *
   * The std140 layout standard (used in both OpenGL and WebGPU) defines strict alignment rules:
   *
   * 1. **Matrix Alignment**: In std140, matrices are stored as arrays of column vectors
   *    - `mat3` requires each column to be aligned to 16 bytes (vec4 alignment)
   *    - This means `mat3` occupies 3 columns × 16 bytes = 48 bytes total
   *    - `mat4` occupies 4 columns × 16 bytes = 64 bytes total
   *
   * 2. **Alignment Issues with mat3**:
   *    - The 48-byte size of `mat3` creates awkward alignment and padding requirements
   *    - Different GPU drivers may handle `mat3` padding inconsistently
   *    - This can lead to data misalignment and incorrect transformations
   *
   * 3. **Why mat4 is Preferred**:
   *    - `mat4` has clean 64-byte alignment (power of 2)
   *    - Consistent behavior across all GPU drivers and platforms
   *    - The shader can easily extract the 3x3 portion: `mat3 transformMat3 = mat3(transformationMatrix)`
   *    - The 4th column is set to `[0, 0, 0, 1]` (homogeneous coordinate) which doesn't affect 2D transforms
   *
   * ### Conversion Process
   *
   * The 3x3 matrix is converted to 4x4 by:
   * - Placing the 3x3 values in the top-left corner (preserving column-major order)
   * - Setting the 4th column to `[0, 0, 0, 1]` (homogeneous coordinate)
   * - The 4th row is implicitly `[0, 0, 0, 1]` due to column-major storage
   *
   * This creates a valid 4x4 transformation matrix that:
   * - Maintains the same 2D transformation behavior
   * - Satisfies std140 alignment requirements
   * - Works consistently across all GPU platforms
   *
   * ### Usage in Shaders
   *
   * Shaders using uniform buffers receive this as `mat4` and extract the 3x3 portion:
   * ```glsl
   * layout(std140) uniform uniforms {
   *   mat4 transformationMatrix;
   * } uniforms;
   *
   * mat3 transformMat3 = mat3(uniforms.transformationMatrix);
   * vec3 final = transformMat3 * vec3(position, 1);
   * ```
   *
   * @returns A 16-element array representing a 4x4 matrix in column-major order,
   *          suitable for std140 uniform buffer layout. The matrix preserves the
   *          2D transformation from the original 3x3 matrix.
   *
   * @example
   * ```typescript
   * const matrix = store.transformationMatrix4x4;
   * uniformStore.setUniforms({
   *   uniforms: {
   *     transformationMatrix: matrix  // Expects mat4x4<f32> in shader
   *   }
   * });
   * ```
   */
  public get transformationMatrix4x4 (): Mat4Array {
    const t = this.transform

    // Validate transform array length
    if (t.length !== 9) {
      throw new Error(`Transform must be a 9-element array (3x3 matrix), got ${t.length} elements`)
    }

    // Convert 3x3 to 4x4 matrix in column-major order
    return [
      t[0], t[1], t[2], 0, // Column 0
      t[3], t[4], t[5], 0, // Column 1
      t[6], t[7], t[8], 0, // Column 2
      0, 0, 0, 1, // Column 3 (homogeneous)
    ]
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
   * Ensures `spaceSize` is always a positive number >= 2 (required for Math.log2).
   */
  public adjustSpaceSize (configSpaceSize: number, webglMaxTextureSize: number): void {
    if (configSpaceSize <= 0 || !isFinite(configSpaceSize)) {
      console.error(`Invalid spaceSize value: ${configSpaceSize}. Using default value of ${defaultConfigValues.spaceSize}`)
      configSpaceSize = defaultConfigValues.spaceSize
    }
    // Enforce minimum value of 2 (since we use Math.log2, minimum should be 2^1 = 2)
    const minSpaceSize = 2
    if (configSpaceSize < minSpaceSize) {
      console.warn(`spaceSize (${configSpaceSize}) is too small. Using minimum value of ${minSpaceSize}`)
      configSpaceSize = minSpaceSize
    }

    // Validate webglMaxTextureSize (values below minSpaceSize are invalid; clamp would exceed limit)
    if (!Number.isFinite(webglMaxTextureSize) || webglMaxTextureSize <= 0 || webglMaxTextureSize < minSpaceSize) {
      console.warn(`Invalid webglMaxTextureSize: ${webglMaxTextureSize}. Using configSpaceSize without WebGL limit adjustment.`)
      this.adjustedSpaceSize = configSpaceSize
      return
    }

    // Handle WebGL limits - ensure result is still >= minSpaceSize
    if (configSpaceSize >= webglMaxTextureSize) {
      this.adjustedSpaceSize = Math.max(webglMaxTextureSize / 2, minSpaceSize)
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

  public setHoveredPointRingColor (color: string | [number, number, number, number]): void {
    const convertedRgba = getRgbaColor(color)
    this.hoveredPointRingColor[0] = convertedRgba[0]
    this.hoveredPointRingColor[1] = convertedRgba[1]
    this.hoveredPointRingColor[2] = convertedRgba[2]
  }

  public setFocusedPointRingColor (color: string | [number, number, number, number]): void {
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

  public updateLinkHoveringEnabled (config: Pick<GraphConfigInterface, 'onLinkClick' | 'onLinkRightClick' | 'onLinkMouseOver' | 'onLinkMouseOut'>): void {
    this.isLinkHoveringEnabled = !!(config.onLinkClick || config.onLinkRightClick || config.onLinkMouseOver || config.onLinkMouseOut)
    if (!this.isLinkHoveringEnabled) {
      this.hoveredLinkIndex = undefined
    }
  }

  public setHoveredLinkColor (color?: string | [number, number, number, number]): void {
    if (color === undefined) {
      this.hoveredLinkColor = [-1, -1, -1, -1]
      return
    }
    const convertedRgba = getRgbaColor(color)
    this.hoveredLinkColor[0] = convertedRgba[0]
    this.hoveredLinkColor[1] = convertedRgba[1]
    this.hoveredLinkColor[2] = convertedRgba[2]
    this.hoveredLinkColor[3] = convertedRgba[3]
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
