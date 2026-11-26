import type { ExperimentDefinition } from '../runtime/experiment'
import { experimentDestination, startingCase } from './experiment-route'
import { findExperiment } from './registry'

// Keep research evidence scoped to its case. A report can link to a standalone
// demonstration so readers can see the workload it describes.
export function unlinkOtherExperiments (host: HTMLElement, current: ExperimentDefinition, related: readonly string[] = []): void {
  for (const link of host.querySelectorAll<HTMLAnchorElement>('a[href^="#/"]')) {
    const hash = link.getAttribute('href')!
    const [path, query] = hash.slice(2).split('?')
    const target = findExperiment(decodeURIComponent(path))
    if (!target || target.id === current.id || related.includes(target.id)) continue
    if (target.presentation === 'demo' && startingCase(target).kind !== 'recorded') {
      const demo = experimentDestination(target, new URLSearchParams(query).get('section'))
      if (demo.href === hash && (!demo.section || demo.section === 'case-live' || demo.section.startsWith('run-'))) continue
    }
    link.replaceWith(...Array.from(link.childNodes))
  }
}
