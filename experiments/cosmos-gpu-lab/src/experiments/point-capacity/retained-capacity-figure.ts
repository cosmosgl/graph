import { count } from '../../runtime/result-format'

// Capacity with reuse through one chain cycle starting at 2,048 points.
const steps = [
  { action: 'Start', points: 2048, slots: 2048 },
  { action: 'Add', points: 8192, slots: 8192 },
  { action: 'Remove', points: 4096, slots: 8192 },
  { action: 'Add', points: 8192, slots: 8192 },
  { action: 'Remove', points: 2048, slots: 8192 },
]

export function renderRetainedCapacity (): string {
  const active = steps.map(step => step.points)
  const capacity = steps.map(step => step.slots)
  const maximum = Math.max(...capacity)
  const x = (step: number): number => 100 * step / steps.length
  const y = (points: number): number => 90 - 80 * points / maximum
  const stepLines = (values: number[]): string => values.map((value, i) => {
    const level = y(value)
    return `<line x1="${x(i)}%" x2="${x(i)}%" y1="${y(values[i - 1] ?? value)}%" y2="${level}%"/>
      <line x1="${x(i)}%" x2="${x(i + 1)}%" y1="${level}%" y2="${level}%"/>`
  }).join('')
  const finalCapacity = capacity.at(-1)!
  const finalActive = active.at(-1)!
  const idle = active.map((points, i) => `<rect class="result-capacity-idle" x="${x(i)}%" y="${y(capacity[i])}%"
    width="${x(1)}%" height="${y(points) - y(capacity[i])}%"/>`).join('')
  const guides = [...new Set(active)].map(points => `<line class="result-capacity-guide" x2="100%" y1="${y(points)}%" y2="${y(points)}%"/>`).join('')
  const dots = active.map((points, i) => `<circle cx="${x(i + 0.5)}%" cy="${y(points)}%" r="2.4"/>`).join('')
  const description = `Active points went ${active.map(count).join(' → ')}. ` +
    `The buffer held ${capacity.map(count).join(' → ')} slots at those steps.`
  const labels = steps.map(({ action, points }) => {
    const total = `${action === 'Start' ? '' : 'to '}${count(points)}`
    return `<span>${action}<strong>${total}</strong></span>`
  }).join('')
  return `<figure class="result-chart">
    <figcaption>
      <span class="result-chart-title">The buffer kept ${count(finalCapacity)} slots as the graph shrank</span>
      <span class="result-chart-context">Chain example · Reuse GPU buffers</span>
    </figcaption>
    <div class="result-capacity-timeline">
      <svg class="result-capacity-plot" role="img" aria-label="${description}">
        ${idle}${guides}
        <g class="result-capacity-active">${stepLines(active)}</g>
        <g class="result-capacity-held">${stepLines(capacity)}</g>
        ${dots}
      </svg>
      <div class="result-capacity-end" aria-hidden="true">
        <span style="top:${y(finalCapacity)}%"><strong>${count(finalCapacity)}</strong> slots held</span>
        <span style="top:${y(finalActive)}%"><strong>${count(finalActive)}</strong> active points</span>
      </div>
      <div class="result-capacity-steps" aria-hidden="true">
        ${labels}
      </div>
    </div>
  </figure>`
}
