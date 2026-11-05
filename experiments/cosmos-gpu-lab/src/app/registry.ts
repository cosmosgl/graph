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

export const experiments = Object.values(modules)
  .map(module => module.experiment)
  .sort((left, right) => left.title.localeCompare(right.title))

validateExperiments(experiments)

export function findExperiment (id: string): ExperimentDefinition | undefined {
  return experiments.find(experiment => experiment.id === id)
}
