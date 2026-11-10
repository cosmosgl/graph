import type { GridBackend } from '../many-body-grid/backend'
import type { Stage } from './data'
export type CombinedBackend = GridBackend & { stepStage(stage: Stage, alpha: number): void }
