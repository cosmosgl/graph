import { createFixture, PARAMETERS, type Input } from '../many-body/data'
import type { View } from '../many-body/backend'

export type Vector = readonly [number, number]
export type Viewport = { width: number; height: number }
export type Camera = { origin: Vector; translation: Vector; zoom: number }
export type MouseGate = {
  simulationEnabled: boolean;
  rightClickRepulsionEnabled: boolean;
  secondaryHeld: boolean;
}

export const SETTINGS = { ...PARAMETERS, alpha: 1 }
export const DEFAULT_STRENGTH = 2
export const MIN_DISTANCE = 10

export function pointerRepulsionActive (state: MouseGate): boolean {
  return state.simulationEnabled && state.rightClickRepulsionEnabled && state.secondaryHeld
}

// CSS pixels enter the same inverse transform as production Zoom. Device pixel
// ratio affects the framebuffer size, while origin and translation are live.
export function screenToWorld (point: Vector, viewport: Viewport, camera: Camera): [number, number] {
  return [
    camera.origin[0] - viewport.width / 2 + (point[0] - camera.translation[0]) / camera.zoom,
    camera.origin[1] + viewport.height / 2 - (point[1] - camera.translation[1]) / camera.zoom,
  ]
}

export function viewFor (viewport: Viewport, camera: Camera): View {
  const center = screenToWorld([viewport.width / 2, viewport.height / 2], viewport, camera)
  return [...center, 2 * camera.zoom / viewport.width, 2 * camera.zoom / viewport.height]
}

export function pointerUniform (point: Vector, strength: number): Float32Array {
  const uniform = new Float32Array([point[0], point[1], strength])
  if (!uniform.every(Number.isFinite)) throw new Error('Expected a finite pointer position and strength')
  return uniform
}

export function semanticsFixture (): Input {
  const points = new Float32Array([
    3, 4, 0, 0, // Inside the distance clamp.
    -6, -8, 0, 0, // Exactly at the clamp.
    12, -16, 0, 0, // Outside the clamp.
    -24, 18, 0, 0,
    0, -5, 0, 0, // Axes.
    -5, 0, 0, 0,
    0, 0, 0, 0, // No direction at coincidence.
    5, -2, 1, 0, // Still computes a force while pinned.
    NaN, NaN, 0, 1, // Absent NaN and finite sentinel.
    9, 8, 0, 1,
    9.999, 0, 0, 0,
    10.001, 0, 0, 0,
  ])
  return { points, samples: new Float32Array(points.length / 2) }
}

export function movingFixture (count: number, origin: Vector): Input {
  const input = createFixture('uniform', count)
  const points = input.points
  for (let i = 0; i < count; i++) {
    const p = i * 4
    points[p] += origin[0]
    points[p + 1] += origin[1]
    if (i % 31 === 0) points[p + 2] = 1
    if (i % 47 === 0) points[p + 3] = 1
  }
  return input
}
