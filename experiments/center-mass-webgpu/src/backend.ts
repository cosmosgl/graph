import type { Center } from './point-state'

export type BackendResult = {
  center: Center;
  elapsedMilliseconds: number;
}

export interface CenterMassBackend {
  readonly label: string;
  run: (positions: Float32Array) => Promise<BackendResult>;
  destroy: () => void;
}
