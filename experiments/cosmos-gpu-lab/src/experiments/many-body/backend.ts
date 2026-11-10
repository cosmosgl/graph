import type { Snapshot } from './reference'
import type { Measurement, Stage } from './timing'
export type View = [number, number, number, number]
export type Backend = {
  name: string;
  info: string;
  setPositions(positions: Float32Array): void;
  step(): void;
  measure(stage: Stage, operations: number): Promise<{ timing: Measurement; snapshot: Snapshot }>;
  read(): Promise<Snapshot>;
  render(view: View): void;
  destroy(): void;
}
export function fitView (positions: Float32Array[]): View {
  let half = 16
  for (const data of positions) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0.5 || !Number.isFinite(data[i]) || !Number.isFinite(data[i + 1])) continue
      half = Math.max(half, Math.abs(data[i + 1]), Math.abs(data[i]) / (480 / 340))
    }
  }
  return [0, 0, 1 / (half * 1.1 * 480 / 340), 1 / (half * 1.1)]
}
