import type { ExperimentCase, ExperimentDefinition } from '../runtime/experiment'
import { caseEvidenceLinks } from '../runtime/experiment'
import { findExperiment } from './registry'
import { articleSectionId } from './router'

// Retain the words and citations in the research record, but do not turn them
// into navigation to a different experiment or case from this experiment.
export function unlinkOtherExperiments (
  host: HTMLElement, current: ExperimentDefinition, item?: ExperimentCase, currentPage?: string
): void {
  for (const link of host.querySelectorAll<HTMLAnchorElement>('a[href^="#/"]')) {
    const hash = link.getAttribute('href')!
    const [path, query] = hash.slice(2).split('?')
    const [id, route, page] = path.split('/').map(decodeURIComponent)
    const target = findExperiment(id)
    if (!target) continue
    const params = new URLSearchParams(query ?? '')
    let unrelated = target.id !== current.id
    if (!unrelated && item) {
      const targetCase = params.get('case')
      if (targetCase && targetCase !== item.id) unrelated = true
      let targetPage = route === 'docs' ? page : params.get('evidence') ?? undefined
      const section = params.get('section')
      if (!targetPage && section?.startsWith('doc-')) {
        targetPage = [...current.pages].sort((a, b) => b.id.length - a.id.length).find(entry =>
          section === articleSectionId(entry.id) || section.startsWith(`${articleSectionId(entry.id)}-`))?.id
      }
      const allowed = new Set([currentPage, ...caseEvidenceLinks(item).map(entry => entry.page)])
      if (targetPage && !allowed.has(targetPage)) unrelated = true
    }
    if (unrelated) link.replaceWith(...Array.from(link.childNodes))
  }
}
