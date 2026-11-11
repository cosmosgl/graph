import type { GridBackend } from '../many-body-grid/backend'
import type { View } from '../many-body/backend'
import type { Measurement } from '../many-body/timing'
import type { Snapshot } from '../many-body/reference'
import type { LinkInput } from './topology'
import type { Stage } from './data'
export type FrameBatch = { frames: number; draw: boolean; decay: number; view: View }
export type CombinedBackend = GridBackend & {
  stepStage(stage: Stage, alpha: number): void;
  stepTick?(alpha: number, tick: number): void;
  replaceLinks?(input: LinkInput): { version: number; bytes: number; edgeCount: number; buildMs: number };
  measureFrames?(options: FrameBatch): Promise<{ timing: Measurement; snapshot: Snapshot }>;
  measureCurrentFrame?(alpha: number, tick: number, view: View): Promise<{ timing: Measurement; snapshot: Snapshot }>;
  measureStage?(stage: Stage, alpha: number, phase: 'force' | 'step', operations: number): ReturnType<GridBackend['measure']>;
  measureSpring?(stage: 'incoming' | 'outgoing', alpha: number, phase: 'force' | 'step', operations: number): ReturnType<GridBackend['measure']>;
}
