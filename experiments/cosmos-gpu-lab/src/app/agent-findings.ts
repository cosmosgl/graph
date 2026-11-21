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
    const warning = document.createElement('p'); warning.className = 'study-findings-warning'; warning.setAttribute('role', 'status')
    warning.textContent = `Some investigation records could not be displayed. Check: ${findings.invalid.join(', ')}`; section.append(warning)
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
    section.append(article)
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
