/** The benchmark always allocates and draws the selected number of real points. */
export const STRESS_POINT_COUNTS: readonly number[] = [1_000_000, 2_000_000, 5_000_000, 10_000_000]

export interface StressRequest {
  count: number;
  seed: number;
}

/** Exact extrema of the returned Float32 world coordinates. */
export type StressBounds = [minX: number, minY: number, maxX: number, maxY: number]

export type StressResponse =
  | { type: 'progress'; generated: number; total: number }
  | { type: 'ready'; positions: Float32Array; generationMs: number; bounds: StressBounds }
  | { type: 'error'; message: string }
