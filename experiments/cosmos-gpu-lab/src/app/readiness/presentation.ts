import type { CaseReadiness, EvidenceTone, ReadinessTone } from './types'

const badgeSymbols = { pass: '✓', review: '▲', fail: '×', neutral: '○' } as const
const evidenceSymbols = { pass: '✓', warn: '▲', fail: '×', info: '○', unknown: '○' } as const
const evidenceLabels: Record<EvidenceTone, string> = {
  pass: 'Passed', warn: 'Warning', fail: 'Failed', info: 'Observed', unknown: 'Open',
}

export function readinessBadge (label: string, tone: ReadinessTone, symbol = true): HTMLSpanElement {
  const badge = document.createElement('span'); badge.className = 'readiness-badge'; badge.dataset.tone = tone
  if (symbol) {
    const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true'); icon.textContent = badgeSymbols[tone]
    badge.append(icon)
  }
  badge.append(document.createTextNode(label))
  return badge
}

export function recordedObservations (observations: CaseReadiness['evidence']): HTMLElement {
  const list = document.createElement('ul'); list.className = 'case-observation-checks'
  list.setAttribute('aria-label', 'Recorded observations and open checks')
  for (const evidence of observations) {
    const item = document.createElement('li'); item.className = 'readiness-evidence'; item.dataset.tone = evidence.tone
    const icon = document.createElement('span'); icon.className = 'readiness-icon'; icon.setAttribute('aria-hidden', 'true')
    icon.textContent = evidenceSymbols[evidence.tone]
    const spoken = document.createElement('span'); spoken.className = 'visually-hidden'; spoken.textContent = `${evidenceLabels[evidence.tone]}: `
    item.append(icon, spoken, document.createTextNode(evidence.text)); list.append(item)
  }
  return list
}
