import { expect, it } from 'vitest'
import { experiments } from '../app/registry'
import { defineExperiment, type ExperimentDefinition } from './experiment'
import { validationContracts } from './validation'

it('gives every discovered example exactly one contract without dropping its original documentation', async () => {
  expect(experiments.map(experiment => experiment.id).sort()).toEqual(Object.keys(validationContracts).sort())
  for (const experiment of experiments) {
    const pages = experiment.pages.filter(page => page.id === 'validation-contract')
    expect(pages).toHaveLength(1); expect(experiment.pages.length).toBeGreaterThan(1)
    expect(await pages[0].load()).toContain('not a live run result')
    expect(await pages[0].load()).toContain('#/validation-workflow')
  }
})

it('rejects missing contracts and reserved page collisions before a demo can start', () => {
  const definition: ExperimentDefinition = {
    id: 'unclassified',
    title: 'Example',
    summary: '',
    tags: [],
    create: async (): Promise<{ destroy(): void }> => ({ destroy (): void {} }),
    pages: [],
  }
  expect(() => defineExperiment(definition)).toThrow('Missing validation contract')
  expect(() => defineExperiment({
    ...definition,
    id: 'center-mass',
    pages: [{
      kind: 'markdown', id: 'validation-contract', title: 'Collision', load: async (): Promise<string> => '',
    }],
  }))
    .toThrow('Reserved validation-contract')
})
