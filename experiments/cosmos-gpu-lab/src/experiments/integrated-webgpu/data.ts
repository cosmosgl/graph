import { createGraph, type Fixture } from '../combined-layout/data'
import { compositionFixture, type CompositionFixture } from '../combined-layout/force-composition'
import { karateEdges } from './karate'
export type Workload = Fixture | 'karate'
export type IntegratedForceMode = 'core' | 'composed' | 'composed-collision'
export function workload (kind: Workload, count = 1024): ReturnType<typeof createGraph> {
  const result = createGraph({ fixture: kind === 'karate' ? 'chain' : kind, count: kind === 'karate' ? 34 : count, decay: 5000 })
  if (kind === 'karate') {
    result.graph.links = new Float32Array(karateEdges.flatMap(([a, b]) => [a, b]))
    result.graph.weights = new Float32Array(karateEdges.map(([, , w]) => w))
  }
  return result
}

export function composeWorkload (data: ReturnType<typeof workload>, mode: IntegratedForceMode): CompositionFixture | undefined {
  if (mode === 'core') return undefined
  const count = data.input.points.length / 4
  return compositionFixture(count, mode === 'composed-collision', data)
}

export const unsupported = [
  'Curves, patterns, arrows, images, rings, transitions and link picking.',
  'Automatic fit, host devices and device recovery.',
  'Fixed screen-space sizes only.',
  'Faint nonzero source opacity below 0.02 is rejected; its visibility remains a parked investigation.',
].join(' ')
export const matrix = [
  ...[1024, 8192].flatMap(count => (['chain', 'communities', 'star'] as const).map(kind => ({ kind, count }))),
  { kind: 'karate' as const, count: 34 },
]
