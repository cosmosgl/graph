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

export function renderReadiness (readiness: CaseReadiness): HTMLElement {
  const section = document.createElement('section'); section.className = 'case-readiness'
  section.setAttribute('aria-label', 'Recorded research assessment')
  const line = document.createElement('div'); line.className = 'case-readiness-line'
  const statusTone = readiness.tone === 'pass' ? 'neutral' : readiness.tone
  line.append(readinessBadge(`${readiness.area} · ${readiness.status}`, statusTone, false))
  for (const evidence of readiness.evidence) {
    const item = document.createElement('span'); item.className = 'readiness-evidence'; item.dataset.tone = evidence.tone
    const icon = document.createElement('span'); icon.className = 'readiness-icon'; icon.setAttribute('aria-hidden', 'true')
    icon.textContent = evidenceSymbols[evidence.tone]
    const spoken = document.createElement('span'); spoken.className = 'visually-hidden'; spoken.textContent = `${evidenceLabels[evidence.tone]}: `
    item.append(icon, spoken, document.createTextNode(evidence.text)); line.append(item)
  }
  const next = document.createElement('p'); next.className = 'case-readiness-next'
  const label = document.createElement('strong'); label.textContent = 'Next: '
  next.append(label, document.createTextNode(readiness.next)); section.append(line, next)
  return section
}
