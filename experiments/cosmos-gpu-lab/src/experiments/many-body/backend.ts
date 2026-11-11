import type { Buffer, Device, ComputePass } from '@luma.gl/core'
import type { Snapshot } from './reference'
import type { Measurement, Stage, TimestampWrites } from './timing'
export type PositionSource = { device: Device; buffer: Buffer; count: number }
export type PositionTransfer = { preserved: number; copiedBytes: number; uploadedBytes: number; copySubmitMs: number }
export type View = [number, number, number, number]
export type Backend = {
  name: string;
  info: string;
  positionTransfer?: PositionTransfer;
  setPositions(positions: Float32Array): void;
  step(timing?: { force?: TimestampWrites; integration?: TimestampWrites; submit?: boolean; pass?: ComputePass }): void;
  patchPositions?(first: number, data: Float32Array): void;
  resourceIdentity?(): { device: string; positions: string[] };
  positionSource?(): PositionSource;
  setAbsent?(index: number, absent: boolean): void;
  measure(stage: Stage, operations: number): Promise<{ timing: Measurement; snapshot: Snapshot }>;
  read(): Promise<Snapshot>;
  render(view: View, timing?: TimestampWrites, submit?: boolean): void;
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
