import type { GraphInput, Parameters, Topology } from './data'
import type { Snapshot } from './reference'
import type { TimerStatus } from './timing'
export type WebGLCheckpoint = { sequence: number; atMs: number; phase: string; contextLost: boolean }
export type SimulationPass = keyof Snapshot
export const SIMULATION_PASSES: SimulationPass[] = ['firstForce', 'intermediate', 'secondForce', 'positions']
export type Stage = 'force' | 'integration' | 'render' | 'tick'
export type Measurement = {
  stage: Stage; operations: number; submitMs: number; completionMs: number; gpuMs: number | null;
  batchSubmitMs: number; batchCompletionMs: number; batchGpuMs: number | null; timerStatus: TimerStatus;
}
export type SetupSubmission = { setupSubmitMs: number; uploadCallMs: number; directionalMaxDegrees?: number[] }
export type RenderProbe = {
  mode: string; verticesPerDraw: number; completionMs: number; checksum: number; coloredPixels: number; matchesBounded: boolean;
}
export interface LinkBackend {
  readonly name: string;
  readonly info: string;
  setGraph(graph: GraphInput, topology: Topology, parameters: Parameters): SetupSubmission;
  synchronize(): Promise<void>;
  reset(): void;
  step(render?: boolean): void;
  render(): void;
  read(frozen?: boolean): Promise<Snapshot>;
  measure(stage: Stage, operations?: number): Promise<Measurement>;
  diagnosePass?(pass: SimulationPass): Promise<Float32Array>;
  diagnoseRender?(progress: (message: string) => void, rows: RenderProbe[], cancelled: () => boolean): Promise<void>;
  destroy(): void;
}
