import type { RgbaSnapshot } from '../../gpu/rgba-readback'
import type { Scene, Settings, Variant } from './data'
export type Probe = {
  varying: Float32Array; vertices: Float32Array;
}
export type Snapshot = RgbaSnapshot & { variant: Variant; probe?: Probe }
export type Backend = { info: string;
  render(scene: Scene, settings: Settings, variant: Variant, display?: boolean, diagnose?: boolean): Promise<Snapshot>; destroy(): void; }
