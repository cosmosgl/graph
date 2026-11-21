import type { RgbaSnapshot } from '../../gpu/rgba-readback'
import type { Scene, Settings, Variant, HardCoverage } from './data'
export type CoverageProbe = {
  varying: Float32Array; pixel: Float32Array; vertices?: Float32Array;
  /** phase/dx/dy/coverage; radius/dx/dy/diameter; t/side/smoothing/width;
   * WebGPU additionally includes fine and coarse phase/dx/dy/coverage. */
  pattern?: Float32Array[];
}
export type Snapshot = RgbaSnapshot & { variant: Variant; hardCoverage?: HardCoverage; probe?: CoverageProbe }
export type Backend = {
  info: string;
  rasterize(clip: number[], width: number, height: number): Promise<Uint8Array>;
  render(scene: Scene, settings: Settings, variant: Variant, display?: boolean, diagnose?: boolean): Promise<Snapshot>;
  destroy(): void;
}
