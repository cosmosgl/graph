import type { TextureFormat } from '@luma.gl/core'
import { textureFormatDecoder } from '@luma.gl/core'

/**
 * Calculates bytesPerRow for texture uploads.
 * @param format - Texture format
 * @param width - Texture width in pixels
 * @returns bytesPerRow in bytes
 */
export function getBytesPerRow (format: TextureFormat, width: number): number {
  const formatInfo = textureFormatDecoder.getInfo(format)
  return width * (formatInfo.bytesPerPixel ?? 0)
}
