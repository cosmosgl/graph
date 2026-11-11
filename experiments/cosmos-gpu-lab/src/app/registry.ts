import type { ExperimentDefinition, ExperimentModule } from '../runtime/experiment'

function validateExperiments (definitions: ExperimentDefinition[]): void {
  const experimentIds = new Set<string>()
  for (const experiment of definitions) {
    if (experimentIds.has(experiment.id)) {
      throw new Error(`Duplicate experiment id: ${experiment.id}`)
    }
    experimentIds.add(experiment.id)

    if (experiment.pages.length === 0) {
      throw new Error(`Experiment ${experiment.id} has no documentation`)
    }

    const pageIds = new Set<string>()
    for (const page of experiment.pages) {
      if (pageIds.has(page.id)) {
        throw new Error(`Duplicate page id in ${experiment.id}: ${page.id}`)
      }
      pageIds.add(page.id)
    }
  }
}

const modules = import.meta.glob<ExperimentModule>('../experiments/*/experiment.ts', {
  eager: true,
})

const definitions = Object.values(modules).map(module => module.experiment)
validateExperiments(definitions)

const ungrouped = new Map(definitions.map(experiment => [experiment.id, experiment]))

// Group and member order are the suggested reading path, independent of titles.
// Every discovered experiment must appear exactly once in this catalog.
export const experimentGroups = [
  {
    id: 'foundations',
    title: 'Foundations',
    description: 'Start with reductions, spatial indexing and basic point rendering.',
    experiments: ['center-mass', 'scalable-reduction', 'spatial-grid', 'point-rendering'],
  },
  {
    id: 'forces',
    title: 'Cosmos forces',
    description: 'Apply the building blocks to local neighbors, global repulsion and linked points.',
    experiments: ['neighborhood-forces', 'many-body', 'many-body-grid', 'weighted-links'],
  },
  {
    id: 'combined',
    title: 'Combined engine',
    description: 'Follow independently evolving layouts, compose the forces and keep a complete frame on the GPU.',
    experiments: ['repulsion-trajectories', 'combined-layout', 'resident-layout', 'matched-layout'],
  },
  {
    id: 'validation',
    title: 'Validation and optimization',
    description: 'Check production settings, measure GPU cost, then investigate bottlenecks and resource capacity.',
    experiments: ['layout-acceptance', 'performance-lab', 'gpu-stage-profile', 'hub-springs', 'cell-aggregation', 'point-capacity'],
  },
].map(({ experiments: ids, ...group }) => ({
  ...group,
  experiments: ids.map(id => {
    const experiment = ungrouped.get(id)
    if (!experiment) throw new Error(`Unknown or already grouped experiment: ${id}`)
    ungrouped.delete(id)
    return experiment
  }),
}))

if (ungrouped.size) throw new Error(`Assign experiments to a catalog group: ${[...ungrouped.keys()].join(', ')}`)

export const experiments = experimentGroups.flatMap(group => group.experiments)

export function findExperiment (id: string): ExperimentDefinition | undefined {
  return experiments.find(experiment => experiment.id === id)
}
