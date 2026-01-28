/**
 * Validates and normalizes array values to fixed-size tuples for shader uniforms.
 */

/**
 * Ensures a value is a vec2 tuple [number, number].
 */
export function ensureVec2 (
  arr: number[] | undefined,
  fallback: [number, number]
): [number, number] {
  if (!arr || arr.length !== 2) return fallback
  return [arr[0], arr[1]] as [number, number]
}

/**
 * Ensures a value is a vec4 tuple [number, number, number, number].
 */
export function ensureVec4 (
  arr: number[] | undefined,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  if (!arr || arr.length !== 4) return fallback
  return [arr[0], arr[1], arr[2], arr[3]] as [number, number, number, number]
}
