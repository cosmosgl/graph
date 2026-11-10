import type { Backend } from '../many-body/backend'
import type { Frame, Structure } from './data'
export type GridBackend = Backend & { setFrame(frame: Frame): void; readStructure(): Promise<Structure> }
