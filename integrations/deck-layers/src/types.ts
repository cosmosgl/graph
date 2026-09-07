import type { PointPositionTexture } from '@cosmos.gl/graph'

/**
 * Anything that exposes a live cosmos.gl position texture — a
 * `GraphSimulation`, a headless `Graph`, or a future engine with the same
 * contract. The layers are typed against this shape, never a concrete class.
 */
export type PositionTextureSource = {
  getPointPositionTexture(): PointPositionTexture | undefined;
}
