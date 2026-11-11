import type { GridBackend } from '../many-body-grid/backend'
import type { Stage } from './data'
export type CombinedBackend = GridBackend & {
  stepStage(stage: Stage, alpha: number): void;
  measureStage?(stage: Stage, alpha: number, phase: 'force' | 'step', operations: number): ReturnType<GridBackend['measure']>;
  measureSpring?(stage: 'incoming' | 'outgoing', alpha: number, phase: 'force' | 'step', operations: number): ReturnType<GridBackend['measure']>;
}
