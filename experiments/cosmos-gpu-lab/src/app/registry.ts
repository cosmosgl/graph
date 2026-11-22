import { pointStylingExperimentIds } from '../experiments/point-styling/cases'
import type { ExperimentDefinition, ExperimentModule } from '../runtime/experiment'
import { caseEvidenceLinks } from '../runtime/experiment'
import { research, researchMethodPages } from './research'

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
    if (!experiment.cases?.length) throw new Error(`Experiment ${experiment.id} has no starting case`)

    const pageIds = new Set<string>()
    for (const page of experiment.pages) {
      if (pageIds.has(page.id)) {
        throw new Error(`Duplicate page id in ${experiment.id}: ${page.id}`)
      }
      pageIds.add(page.id)
    }
    const record = research[experiment.id]
    if (!record) throw new Error(`Add a research assessment for ${experiment.id}`)
    const methodIds = researchMethodPages(record)
    const evidenceIds = record.investigations.map(item => item.page)
    const caseEvidenceIds = experiment.cases?.flatMap(item => caseEvidenceLinks(item).map(link => link.page)) ?? []
    if (new Set(evidenceIds).size !== evidenceIds.length) throw new Error(`Duplicate evidence in ${experiment.id}`)
    for (const id of [...methodIds, ...evidenceIds, ...record.evidence ? [record.evidence] : []]) {
      if (!pageIds.has(id)) throw new Error(`Unknown research page ${experiment.id}/${id}`)
    }
    for (const id of pageIds) {
      if (!methodIds.includes(id) && !evidenceIds.includes(id) && !caseEvidenceIds.includes(id)) {
        throw new Error(`Assign ${experiment.id}/${id} to Method or Evidence`)
      }
    }
    if (record.evidence && !evidenceIds.includes(record.evidence)) throw new Error(`Current evidence is not indexed in ${experiment.id}`)
    for (const item of record.investigations) {
      if (item.replacement && !evidenceIds.includes(item.replacement)) throw new Error(`Unknown replacement in ${experiment.id}/${item.page}`)
    }
  }
}

const modules = import.meta.glob<ExperimentModule>('../experiments/*/experiment.ts', {
  eager: true,
})

const definitions = Object.values(modules).flatMap(module => 'experiments' in module ? module.experiments : [module.experiment])
validateExperiments(definitions)

export const experiments = definitions.sort((a, b) => a.title.localeCompare(b.title))

export function findExperiment (id: string): ExperimentDefinition | undefined {
  return experiments.find(experiment => experiment.id === id)
}

const catalogTopics = [
  {
    id: 'rendering',
    title: 'Rendering and interaction',
    description: 'How points and links are drawn and selected.',
    ids: ['point-rendering', 'straight-links', 'smoothstep-coverage', 'curved-links', 'ribbon-generation'],
  },
  {
    id: 'point-styling',
    title: 'Point styling and picking',
    description: 'WebGL and WebGPU comparisons for points.',
    ids: Object.values(pointStylingExperimentIds),
  },
  {
    id: 'forces-motion',
    title: 'Forces and motion',
    description: 'The forces that shape and move graphs.',
    ids: ['center-mass', 'neighborhood-forces', 'many-body', 'many-body-grid', 'workgroup-repulsion', 'weighted-links',
      'collision', 'cluster-attraction', 'point-attractors', 'mouse-repulsion', 'hub-springs'],
  },
  {
    id: 'whole-graphs',
    title: 'Whole graphs and layouts',
    description: 'Complete layouts and interactive graphs.',
    ids: ['repulsion-trajectories', 'combined-layout', 'resident-layout', 'resident-layout-edits', 'million-graph', 'integrated-webgpu',
      'viewer-comparison', 'dense-communities', 'hub-communities', 'youtube-network', 'pilot-viewer', 'matched-layout'],
  },
  {
    id: 'gpu-foundations',
    title: 'GPU foundations',
    description: 'Reductions, spatial indexing and memory.',
    ids: ['scalable-reduction', 'spatial-grid', 'point-capacity', 'point-buffer-copy', 'cell-aggregation'],
  },
  {
    id: 'precision-performance',
    title: 'Precision and performance',
    description: 'Numerical accuracy, production checks and GPU cost.',
    ids: ['precision-diagnostics', 'layout-acceptance', 'performance-lab', 'resident-frame-timing', 'gpu-stage-profile'],
  },
]

const assigned = new Set<string>()
export const experimentGroups = catalogTopics.map(({ ids, ...topic }) => ({
  ...topic,
  experiments: ids.map(id => {
    const experiment = findExperiment(id)
    if (!experiment || assigned.has(id)) throw new Error(`Unknown or duplicate catalog experiment: ${id}`)
    assigned.add(id)
    return experiment
  }).sort((a, b) => a.title.localeCompare(b.title)),
}))

// Newly discovered studies remain visible until they are assigned a topic.
const unassigned = experiments.filter(experiment => !assigned.has(experiment.id))
if (unassigned.length) {
  experimentGroups.push({ id: 'other', title: 'More experiments', description: 'Other studies in the lab.', experiments: unassigned })
}
