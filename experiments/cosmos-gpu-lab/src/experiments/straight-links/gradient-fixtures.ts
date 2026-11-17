import type { Scene } from './data'
export const GRADIENT_PRESETS = ['solid', 'endpoints', 'endpoint-alpha', 'defaults'] as const
export type GradientPreset = typeof GRADIENT_PRESETS[number]
export const GRADIENT_LABELS = ['Link color · control', 'Endpoint RGB', 'Endpoint alpha ignored', 'Default endpoint channels']
export function gradientScene (scene: Scene, preset: GradientPreset): Scene {
  if (preset === 'solid') return scene
  return {
    ...scene,
    points: scene.points.map((p, i) => ({
      ...p,
      color: preset === 'defaults'
        ? i % 2 ? [0.1, NaN, 0.9, NaN] : [NaN, 0.2, 0.1, 0]
        : i % 2 ? [0.1, 0.3, 0.9, preset === 'endpoint-alpha' ? 0 : 1] : [0.9, 0.2, 0.1, preset === 'endpoint-alpha' ? 0.35 : 1],
    })),
  }
}
