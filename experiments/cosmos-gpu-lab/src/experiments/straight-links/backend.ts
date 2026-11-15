import type { RgbaSnapshot } from '../../gpu/rgba-readback'
import type { Scene, Settings, Variant, HardCoverage } from './data'
export type CoverageProbe = { varying: Float32Array; pixel: Float32Array }
export type Snapshot = RgbaSnapshot & { variant: Variant; hardCoverage?: HardCoverage; probe?: CoverageProbe }
export type Backend = {
  info: string;
  render(scene: Scene, settings: Settings, variant: Variant, display?: boolean, diagnose?: boolean): Promise<Snapshot>;
  destroy(): void;
}
