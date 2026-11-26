import type { RgbaSnapshot } from '../../gpu/rgba-readback'
import type { Scene, Settings, Variant } from './data'

export type Snapshot = RgbaSnapshot & { variant: Variant }
export type Backend = {
  info: string;
  render(scene: Scene, settings: Settings, variant: Variant, display?: boolean): Promise<Snapshot>;
  destroy(): void;
}
