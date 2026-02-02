import { color as d3Color } from 'd3-color'
import { Device, Framebuffer } from '@luma.gl/core'
import { WebGLDevice } from '@luma.gl/webgl'
import { GL } from '@luma.gl/constants'
import DOMPurify from 'dompurify'

import { MAX_POINT_SIZE } from '@/graph/modules/Store'

export const isFunction = <T>(a: T): boolean => typeof a === 'function'
export const isArray = <T>(a: unknown | T[]): a is T[] => Array.isArray(a)
export const isObject = <T>(a: T): boolean => (a instanceof Object)
export const isAClassInstance = <T>(a: T): boolean => {
  if (a instanceof Object) {
    // eslint-disable-next-line @typescript-eslint/ban-types
    return (a as T & Object).constructor.name !== 'Function' && (a as T & Object).constructor.name !== 'Object'
  } else return false
}
export const isPlainObject = <T>(a: T): boolean => isObject(a) && !isArray(a) && !isFunction(a) && !isAClassInstance(a)

export function getRgbaColor (value: string | [number, number, number, number]): [number, number, number, number] {
  let rgba: [number, number, number, number]
  if (isArray(value)) {
    rgba = value
  } else {
    const color = d3Color(value)
    const rgb = color?.rgb()
    rgba = [rgb?.r || 0, rgb?.g || 0, rgb?.b || 0, color?.opacity ?? 1]
  }

  return [
    rgba[0] / 255,
    rgba[1] / 255,
    rgba[2] / 255,
    rgba[3],
  ]
}

export function rgbToBrightness (r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * TODO: Migrate from deprecated `readPixelsToArrayWebGL` to CommandEncoder API
 *
 * `readPixelsToArrayWebGL` is deprecated in luma.gl v9. The recommended modern approach is:
 *
 * 1. Create a buffer to hold the pixel data:
 *    const buffer = device.createBuffer({
 *      byteLength: width * height * 4 * 4, // RGBA, 4 bytes per float
 *      usage: Buffer.COPY_DST | Buffer.MAP_READ
 *    });
 *
 * 2. Copy texture/framebuffer to buffer using command encoder:
 *    const commandEncoder = device.createCommandEncoder();
 *    commandEncoder.copyTextureToBuffer({
 *      sourceTexture: fbo, // Can be Texture or Framebuffer
 *      width: sourceWidth ?? fbo.width,
 *      height: sourceHeight ?? fbo.height,
 *      origin: [sourceX, sourceY],
 *      destinationBuffer: buffer
 *    });
 *    const commandBuffer = commandEncoder.finish();
 *    device.submit(commandBuffer);
 *
 * 3. Read the data from the buffer (async):
 *    const pixelData = await buffer.readAsync(); // Returns ArrayBuffer
 *    return new Float32Array(pixelData);
 *
 * Note: The modern approach is asynchronous, so this function signature would need to change
 * to return Promise<Float32Array> or we'd need to handle async at all call sites (18 locations).
 *
 * Migration impact:
 * - This function is used in 18 places across the codebase
 * - All call sites would need to be updated to handle async
 * - Consider batching the migration to avoid inconsistencies
 *
 * Current status: Deprecated but still functional. Keeping for now until full migration can be planned.
 *
 * @note Cosmos currently supports WebGL only; support for other device types will be added later.
 */
export function readPixels (device: Device, fbo: Framebuffer, sourceX = 0, sourceY = 0, sourceWidth?: number, sourceHeight?: number): Float32Array {
  // Let luma.gl auto-allocate based on texture format
  // It will use Float32Array for rgba32float textures
  return device.readPixelsToArrayWebGL(fbo, {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  }) as Float32Array
}

/**
 * Returns the maximum point size supported by the device, scaled by pixel ratio.
 * For WebGL devices, reads the limit from the context; for other device types, uses MAX_POINT_SIZE from Store.
 * @param device - The luma.gl device
 * @param pixelRatio - Device pixel ratio to scale the result
 * @returns Maximum point size (device limit / pixelRatio)
 */
export function getMaxPointSize (device: Device, pixelRatio: number): number {
  switch (device.info.type) {
  case 'webgl': {
    const range = (device as WebGLDevice).gl.getParameter(GL.ALIASED_POINT_SIZE_RANGE) as [number, number]
    return (range?.[1] ?? MAX_POINT_SIZE) / pixelRatio
  }
  case 'webgpu':
    // Will be implemented when WebGPU support is added
    return MAX_POINT_SIZE / pixelRatio
  default:
    return MAX_POINT_SIZE / pixelRatio
  }
}

export function clamp (num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max)
}

export function isNumber (value: number | undefined | null | typeof NaN): boolean {
  return value !== undefined && value !== null && !Number.isNaN(value)
}

/**
 * Sanitizes HTML content to prevent XSS attacks using DOMPurify
 *
 * This function is used internally to sanitize HTML content before setting innerHTML,
 * such as in attribution text. It uses a safe default configuration that allows
 * only common safe HTML elements and attributes.
 *
 * @param html The HTML string to sanitize
 * @param options Optional DOMPurify configuration options to override defaults
 * @returns Sanitized HTML string safe for innerHTML usage
 */
export function sanitizeHtml (html: string, options?: DOMPurify.Config): string {
  return DOMPurify.sanitize(html, {
    // Default configuration: allow common safe HTML elements and attributes
    ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'span', 'div', 'p', 'br'],
    ALLOWED_ATTR: ['href', 'target', 'class', 'id', 'style'],
    ALLOW_DATA_ATTR: false,
    ...options,
  })
}
