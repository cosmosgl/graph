import type { Pair, Query } from '../../selection/reference'
import type { BenchmarkFixture } from './fixture'
import type { PresentationObserver } from './presentation'

export type Tracked = ReadonlyMap<number, Pair>
export type Backend = 'webgl' | 'webgpu'
export type ResolvedPick = (id: number | null, event: MouseEvent) => void
export type BenchmarkAdapter = {
  canvas: HTMLCanvasElement;
  readonly tick: number;
  readonly peakBytes: number;
  readonly info: { [key: string]: unknown; type: string; renderer?: string; vendor?: string; fallback?: boolean };
  readonly error: string;
  run(): void;
  pause(): void;
  track(indices: number[]): void;
  tracked(): Promise<Tracked | null>;
  select(query: Query): Promise<number[] | null>;
  spaceToScreenPosition(position: Pair): Pair;
  screenToWorld(position: Pair): Pair;
  spaceToScreenRadius(radius: number): number;
  getPointRadiusByIndex(index: number): number | undefined;
  positionUpdate(id: number, world: Pair, pin?: boolean): void;
  topologyUpdate(): void;
  replace(): void;
  resize(width: number, height: number): void;
  positions(): Promise<Float32Array>;
  destroy(): void;
}

export type CreateAdapter = (
  host: HTMLDivElement, fixture: BenchmarkFixture, observer: PresentationObserver, picked: ResolvedPick
) => Promise<BenchmarkAdapter>
