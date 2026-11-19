import type { ExperimentCase } from '../../runtime/experiment'
import type { CaseReadiness } from './types'
import { graphsAndFoundations } from './graphs-foundations'
import { renderingAndForces } from './rendering-forces'

// The assessments are editorial summaries of each case's recorded evidence.
// Never infer integration readiness from a live result or a passing test count.
export const caseAssessments: Record<string, CaseReadiness> = {
  ...renderingAndForces,
  ...graphsAndFoundations,
}

export function readinessFor (experimentId: string, item: ExperimentCase): CaseReadiness {
  return caseAssessments[`${experimentId}/${item.id}`] ?? {
    badge: 'Not assessed',
    tone: 'neutral',
    finding: item.recorded?.conclusion ?? 'No recorded finding is available yet.',
    area: 'Integration',
    status: 'Not assessed',
    evidence: [{ tone: 'unknown', text: 'Integration readiness has not been assessed.' }],
    next: 'Review the evidence for this case.',
  }
}
