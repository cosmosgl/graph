import type { GraphInput } from '../weighted-links/data'
import type { Input } from '../many-body/data'
import { createCombinedWebGL } from '../combined-layout/webgl'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import type { CombinedBackend } from '../combined-layout/backend'
import { forceSettings, type ForceSettings } from '../combined-layout/production-settings'
import { stagesFor, type Stage } from '../combined-layout/data'
import { DEFAULT_CENTER_REDUCTION } from '../combined-layout/center-reduction'
import type { Settings, CollisionArithmetic } from './data'
import { DEFAULT_COLLISION_ARITHMETIC } from './data'
export type Api = 'webgl' | 'webgpu'
export function parametersFor (settings: Settings): ForceSettings {
  return {
    ...forceSettings('varied32', settings.count),
    origin: [2048, 2048],
    center: settings.mode === 'combined' ? 1 : 0,
    centerReduction: settings.centerReduction ?? DEFAULT_CENTER_REDUCTION,
    collision: { ...settings.collision },
    collisionArithmetic: settings.arithmetic ?? DEFAULT_COLLISION_ARITHMETIC,
  }
}
export function sequence (mode: Settings['mode'], settings: ForceSettings): readonly Stage[] {
  return mode === 'combined'
    ? stagesFor(settings.center, settings.collision)
    : settings.collision?.strength ? Array.from({ length: settings.collision.iterations }, () => 'collision' as const) : []
}
export async function createBackend (
  api: Api, canvas: HTMLCanvasElement, graph: GraphInput, input: Input, parameters: ForceSettings,
  collisionAlternatives?: readonly CollisionArithmetic[]
): Promise<CombinedBackend> {
  return api === 'webgl'
    ? await createCombinedWebGL(canvas, graph, input, { forceSettings: parameters, repulsionPolicy: 'production' })
    : await createCombinedWebGPU(canvas, graph, input, 'trig', {
      forceSettings: parameters,
      repulsionPolicy: 'production',
      gpuBounds: true,
      springOptimization: 'prefetch',
      gridAggregation: 'cached-small',
      collisionAlternatives,
    })
}
