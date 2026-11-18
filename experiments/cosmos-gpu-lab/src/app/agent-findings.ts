import type { ExperimentDefinition } from '../runtime/experiment'
import { articleSectionId, experimentHref } from './router'

function paragraph (label: string, value: string): HTMLParagraphElement {
  const element = document.createElement('p'); const title = document.createElement('strong')
  title.textContent = `${label}: `; element.append(title, document.createTextNode(value))
  return element
}

export function renderAgentFindings (experiment: ExperimentDefinition): HTMLElement | undefined {
  const study = experiment.study!
  const findings = study.agentFindings
  if (!findings || (!findings.records.length && !findings.invalid.length)) return undefined
  const section = document.createElement('section'); section.id = 'study-investigations'; section.className = 'study-investigations'
  const title = document.createElement('h2'); title.textContent = 'Investigations'; section.append(title)
  if (findings.invalid.length) {
    const warning = document.createElement('p'); warning.setAttribute('role', 'status')
    warning.textContent = 'Some investigation records could not be displayed. Check the record files.'; section.append(warning)
  }
  for (const finding of findings.records) {
    const article = document.createElement('article'); article.className = 'study-investigation'; article.id = `study-finding-${finding.id}`
    const question = document.createElement('h3'); question.textContent = finding.question; article.append(question)
    if (finding.status === 'incomplete') {
      const status = document.createElement('p'); status.className = 'study-finding-status'; status.textContent = 'Incomplete'; article.append(status)
    }
    article.append(paragraph('Result', finding.result), paragraph('Limits', finding.limits))
    const recorded = document.createElement('p'); recorded.className = 'study-source'
    recorded.textContent = `Recorded ${finding.recordedAt}`; article.append(recorded)
    if (finding.evidenceSection) {
      const evidence = document.createElement('a')
      evidence.href = experimentHref(experiment.id, study.record.sourcePage, finding.evidenceSection)
      evidence.dataset.findingTarget = articleSectionId(study.record.sourcePage, finding.evidenceSection)
      evidence.textContent = 'Read the evidence'; article.append(evidence)
    }
    const details = document.createElement('details'); details.className = 'study-finding-reproduction'
    const summary = document.createElement('summary'); summary.textContent = 'Instructions for agents'; details.append(summary)
    const source = finding.source
    const description = [`Revision: ${source.revision ?? 'Not recorded'}`, `Source state: ${source.state}`,
      ...(source.snapshot ? [`Snapshot: ${source.snapshot}`] : [])].join(' · ')
    details.append(paragraph('Environment', finding.environment), paragraph('Evidence', finding.evidence), paragraph('Source', description))
    const steps = document.createElement('ol')
    for (const step of finding.reproduction) { const item = document.createElement('li'); item.textContent = step; steps.append(item) }
    details.append(steps)
    if (finding.replaySection) {
      const replay = document.createElement('a'); replay.href = experimentHref(experiment.id, study.recipePage, finding.replaySection)
      replay.dataset.findingTarget = articleSectionId(study.recipePage, finding.replaySection)
      replay.textContent = 'Exact replay instructions'; details.append(replay)
    }
    article.append(details); section.append(article)
  }
  return section
}

// Optional links refer to headings loaded asynchronously with the experiment notes.
export function checkAgentFindingLinks (host: HTMLElement): void {
  for (const link of host.querySelectorAll<HTMLAnchorElement>('[data-finding-target]')) {
    if (host.querySelector(`#${CSS.escape(link.dataset.findingTarget!)}`)) continue
    const message = document.createElement('span'); message.className = 'study-finding-unavailable'
    message.textContent = `${link.textContent} unavailable`; link.replaceWith(message)
  }
}
