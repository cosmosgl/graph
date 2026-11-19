import { SETTINGS as CLUSTER, fixture as clusterFixture, type ClusterInput } from '../cluster-attraction/data'
import { reference as clusterReference } from '../cluster-attraction/reference'
import { COLLISION } from '../collision/data'
import type { Snapshot } from '../many-body/reference'
import { mouseReference } from '../mouse-repulsion/reference'
import { SETTINGS as ATTRACTOR, fixture as attractorFixture, type AttractorInput } from '../point-attractors/data'
import { reference as attractorReference } from '../point-attractors/reference'
import { createGraph, REPULSION, stagesFor, type Stage } from './data'
import { forceSettings, type ForceSettings } from './production-settings'
import { createOracle } from './reference'
import type { ExtendableStage, MouseForce } from './webgpu'

export type ComposedStage = Stage | ExtendableStage

export function compositionFixture (count: number, collision: boolean): ReturnType<typeof createGraph> & {
  settings: ForceSettings; cluster: ClusterInput; attractor: AttractorInput;
} {
  const { graph, input } = createGraph({ fixture: 'communities', count, decay: 40 })
  // The two fixed IDs participate in the declared graph topology.
  input.points[2] = 1
  input.points[7] = 1
  const cluster = { ...clusterFixture('targets', count), ...input }
  for (let group = 0; group < cluster.targets.length / 4; group += 2) cluster.targets[group * 4 + 2] = 0
  const attractor = { ...attractorFixture('mixed', count), ...input }
  const settings: ForceSettings = { ...forceSettings('reference', count), center: 0.1 }
  if (collision) settings.collision = { ...COLLISION, iterations: 2 }
  return { graph, input, cluster, attractor, settings }
}

export function createCompositionOracle ({ graph, input, settings, cluster }: ReturnType<typeof compositionFixture>): {
  order(held: MouseForce | undefined, attractor: AttractorInput): ComposedStage[];
  stage(name: ComposedStage, positions: Float32Array, alpha: number, tick: number,
    held: MouseForce | undefined, attractor: AttractorInput): Snapshot;
} {
  const core = createOracle(graph, input, 'production', settings)
  return {
    order (held, attractor): ComposedStage[] {
      // Read the original target channel here, independently of GPU packing.
      const active = attractor.targets?.length === input.points.length / 2 && attractor.targets.some(
        (x, i, targets) => i % 2 === 0 && Number.isFinite(x) && Number.isFinite(targets[i + 1])
      )
      const steps: ComposedStage[] = held ? ['mouse'] : []
      steps.push(...stagesFor(settings.center), 'cluster')
      if (active) steps.push('attractor')
      if (settings.collision?.strength) for (let i = 0; i < settings.collision.iterations; i++) steps.push('collision')
      return steps
    },
    stage (name, positions, alpha, tick, held, attractor): Snapshot {
      if (name === 'mouse' && held) return mouseReference(positions, held.world, held.strength, { ...REPULSION, alpha })
      if (name === 'mouse') throw new Error('Missing mouse input')
      if (name === 'cluster') return clusterReference(cluster, positions, { ...CLUSTER, alpha })
      if (name === 'attractor') return attractorReference(attractor, positions, { ...ATTRACTOR, alpha })
      return core.stage(name, positions, alpha, tick)
    },
  }
}
