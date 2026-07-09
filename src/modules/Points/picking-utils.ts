import type { Hovered } from '@/graph/modules/Store'
import {
  PICKING_RESOLUTION_SCALE,
  MAX_PICKING_BUFFER_DIMENSION,
  PICKING_WINDOW_SIZE,
} from '@/graph/modules/Points/picking-constants'

/** A cursor-centered read window into the picking buffer, in buffer pixels. */
export interface PickingWindow {
  /** Bottom-left corner of the clamped window. */
  x: number;
  y: number;
  /** Unclamped cursor position in buffer pixels (may sit outside the window at edges). */
  centerX: number;
  centerY: number;
}

/** Element-wise equality for two numeric arrays (used to diff the view transform). */
export function numberArraysEqual (a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (const [i, value] of a.entries()) {
    if (value !== b[i]) return false
  }
  return true
}

/**
 * Picking-buffer dimensions for a given screen size: `PICKING_RESOLUTION_SCALE`
 * of the screen, capped at `MAX_PICKING_BUFFER_DIMENSION`, and never smaller
 * than one read window.
 */
export function getPickingBufferSize (screenWidth: number, screenHeight: number): { width: number; height: number } {
  const scale = Math.min(PICKING_RESOLUTION_SCALE, MAX_PICKING_BUFFER_DIMENSION / Math.max(screenWidth, screenHeight))
  return {
    width: Math.max(PICKING_WINDOW_SIZE, Math.ceil(screenWidth * scale)),
    height: Math.max(PICKING_WINDOW_SIZE, Math.ceil(screenHeight * scale)),
  }
}

/**
 * Maps the cursor (bottom-left-origin CSS px, matching the framebuffer
 * orientation) into a `PICKING_WINDOW_SIZE` window clamped inside the buffer.
 */
export function getPickingWindow (
  bufferWidth: number,
  bufferHeight: number,
  mouseX: number,
  mouseY: number,
  screenWidth: number,
  screenHeight: number
): PickingWindow {
  const centerX = mouseX * (bufferWidth / screenWidth)
  const centerY = mouseY * (bufferHeight / screenHeight)
  const half = Math.floor(PICKING_WINDOW_SIZE / 2)
  const x = Math.min(Math.max(Math.round(centerX) - half, 0), bufferWidth - PICKING_WINDOW_SIZE)
  const y = Math.min(Math.max(Math.round(centerY) - half, 0), bufferHeight - PICKING_WINDOW_SIZE)
  return { x, y, centerX, centerY }
}

/**
 * Scans a `PICKING_WINDOW_SIZE`² block of [index, x, y, _] pixels and returns
 * the valid candidate (index >= 0) nearest the cursor, or `undefined` if the
 * window is empty. `cursorX`/`cursorY` are in window-local buffer pixels.
 */
export function resolveNearestPickedPoint (pixels: Float32Array, cursorX: number, cursorY: number): Hovered | undefined {
  let bestIndex = -1
  let bestPosition: [number, number] = [0, 0]
  let bestDistanceSq = Infinity
  for (let py = 0; py < PICKING_WINDOW_SIZE; py += 1) {
    for (let px = 0; px < PICKING_WINDOW_SIZE; px += 1) {
      const offset = (py * PICKING_WINDOW_SIZE + px) * 4
      const index = pixels[offset] as number
      if (index < 0) continue
      // Pixel centers sit at +0.5
      const dx = px + 0.5 - cursorX
      const dy = py + 0.5 - cursorY
      const distanceSq = dx * dx + dy * dy
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestIndex = index
        bestPosition = [pixels[offset + 1] as number, pixels[offset + 2] as number]
      }
    }
  }
  if (bestIndex < 0) return undefined
  return {
    index: bestIndex,
    position: bestPosition,
  }
}
