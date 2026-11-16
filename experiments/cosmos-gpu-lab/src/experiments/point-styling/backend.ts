import { HEIGHT, WIDTH, type Point, type Settings } from './data'
import type { StoredAlphaOptions, StoredAlphaResult } from './stored-alpha'
import type { DynamicAtlas } from './dynamic-atlas'
export { target, pixels, floatPixels, pick } from '../../gpu/rgba-readback'
export type Probe = { geometry: Float32Array; edge: Float32Array }
export type RenderVariant = 'production' | 'explicit' | 'quantized' | 'eligibility'
export type PickingRule = 'legacy' | 'visible' | 'source-alpha' | 'stored-alpha'
export type Snapshot = {
  width: number; height: number; color: Uint8Array; ids: Uint8Array; probe?: Probe; analyticControl?: Snapshot; pickingRule?: PickingRule;
  storedAlpha?: StoredAlphaResult;
  polygonArithmetic?: 'normalized' | 'pixels';
  atlasIsolation?: Settings['atlasIsolation']; atlasGutterExtent?: number;
  atlasPacking?: Settings['atlasPacking'];
  atlasSource?: Settings['atlasSource']; atlasGeneration?: number;
}
export type Backend = {
  atlas: DynamicAtlas;
  info: string;
  render(points: Point[], settings: Settings, diagnose?: boolean, variant?: RenderVariant, display?: boolean,
    storedAlpha?: StoredAlphaOptions): Promise<Snapshot>;
  destroy(): void;
}
export function dimensions (settings: Settings): [number, number] { return [WIDTH * settings.ratio, HEIGHT * settings.ratio] }
