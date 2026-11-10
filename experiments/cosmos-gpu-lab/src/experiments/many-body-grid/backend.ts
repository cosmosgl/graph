import type { Backend } from '../many-body/backend'
import type { DivisionCheck } from './division-check'
import type { Trace } from './trace'
import type { Frame, Structure } from './data'
export type GridBackend = Backend & {
  setFrame(frame: Frame): void;
  readStructure(): Promise<Structure>;
  readCentroids?(): Promise<Float32Array>;
  readContributions?(target: number): Promise<{ data: Float32Array; forces: Float32Array }>;
  verifyDivision?(): Promise<DivisionCheck>;
  // Replay the last step before changing its source positions or frame.
  diagnose?(): Promise<{ trace: Trace; forces: Float32Array }>;
}
