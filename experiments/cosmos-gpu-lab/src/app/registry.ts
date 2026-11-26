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

type CatalogTopic = {
  id: string;
  title: string;
  cards?: string[];
  links?: string[];
}

const catalogTopics: CatalogTopic[] = [
  {
    id: 'rendering',
    title: 'Rendering and picking',
    cards: ['point-rendering', 'point-shapes', 'point-picking', 'straight-links'],
    links: ['production-points', 'production-lines', 'selection', 'point-images', 'point-rings-greyout', 'curved-links', 'smoothstep-coverage'],
  },
  {
    id: 'gpu-foundations',
    title: 'GPU foundations',
    cards: ['scalable-reduction', 'spatial-grid', 'point-capacity', 'point-buffer-copy'],
  },
  {
    id: 'forces-motion',
    title: 'Forces and layout',
    cards: ['many-body', 'weighted-links', 'collision', 'resident-layout'],
    links: ['production-force-collision', 'production-forces', 'resident-layout-edits'],
  },
  {
    id: 'whole-graphs',
    title: 'Whole-graph demos',
    cards: ['dense-communities', 'hub-communities', 'youtube-network'],
  },
  {
    id: 'force-studies',
    title: 'Force implementations',
    links: ['center-mass', 'neighborhood-forces', 'many-body-grid', 'workgroup-repulsion', 'hub-springs',
      'cell-aggregation', 'cluster-attraction', 'point-attractors', 'mouse-repulsion'],
  },
  {
    id: 'viewer-studies',
    title: 'Layout and viewer integration',
    links: ['combined-layout', 'integrated-webgpu', 'production-graph-api', 'viewer-comparison', 'million-graph'],
  },
  {
    id: 'precision-performance',
    title: 'Precision and performance',
    links: ['precision-diagnostics', 'performance-lab', 'resident-frame-timing', 'gpu-stage-profile', 'integrated-webgpu-benchmarks'],
  },
  {
    id: 'milestones',
    title: 'Earlier milestones',
    links: ['pilot-viewer', 'matched-layout', 'ribbon-generation', 'repulsion-trajectories', 'layout-acceptance'],
  },
]

const assigned = new Set<string>()
function catalogEntry (id: string): ExperimentDefinition {
  const experiment = findExperiment(id)
  if (!experiment || assigned.has(id)) throw new Error(`Unknown or duplicate catalog experiment: ${id}`)
  assigned.add(id)
  return experiment
}

export const experimentGroups = catalogTopics.map(({ id, title, cards = [], links = [] }) => {
  const featured = cards.map(catalogEntry)
  const linked = links.map(catalogEntry)
  return { id, title, cards: featured, links: linked, experiments: [...featured, ...linked] }
})

const unassigned = experiments.filter(experiment => !assigned.has(experiment.id))
if (unassigned.length) {
  experimentGroups.push({ id: 'other', title: 'Other studies', cards: [], links: unassigned, experiments: unassigned })
}
