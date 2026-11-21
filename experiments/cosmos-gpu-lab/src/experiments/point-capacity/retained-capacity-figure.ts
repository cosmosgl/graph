import { count } from '../../runtime/result-format'

// Recorded chain resize cycle in the retained-capacity findings.
const steps = [['Start', 2048], ['Grow', 8192], ['Shrink', 4096], ['Grow', 8192], ['Shrink', 2048]] as const
const active = steps.map(([, points]) => points)
const capacity = active.map((_, index) => Math.max(...active.slice(0, index + 1)))
const maximum = Math.max(...capacity)
const x = (step: number): number => 100 * step / steps.length
const y = (points: number): number => 90 - 80 * points / maximum

function stepLines (values: number[]): string {
  return values.map((value, i) => {
    const level = y(value)
    return `<line x1="${x(i)}%" x2="${x(i)}%" y1="${y(values[i - 1] ?? value)}%" y2="${level}%"/>
      <line x1="${x(i)}%" x2="${x(i + 1)}%" y1="${level}%" y2="${level}%"/>`
  }).join('')
}

export function renderRetainedCapacity (host: HTMLElement): void {
  const finalCapacity = capacity.at(-1)!
  const finalActive = active.at(-1)!
  const idle = active.map((points, i) => `<rect class="result-capacity-idle" x="${x(i)}%" y="${y(capacity[i])}%"
    width="${x(1)}%" height="${y(points) - y(capacity[i])}%"/>`).join('')
  const guides = [...new Set(active)].map(points => `<line class="result-capacity-guide" x2="100%" y1="${y(points)}%" y2="${y(points)}%"/>`).join('')
  const dots = active.map((points, i) => `<circle cx="${x(i + 0.5)}%" cy="${y(points)}%" r="2.4"/>`).join('')
  const description = `The graph went from ${active.map(count).join(' to ')} active points. ` +
    `Capacity grew from ${count(capacity[0])} to ${count(finalCapacity)} slots on the first resize and stayed there.`
  host.innerHTML = `<figure class="result-chart">
    <figcaption>
      <span class="result-chart-title">The buffer kept ${count(finalCapacity)} slots as the graph shrank</span>
      <span class="result-chart-context">Recorded chain resize cycle · Retained buffers</span>
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
        ${steps.map(([action, points]) => `<span>${action}<strong>${count(points)}</strong></span>`).join('')}
      </div>
    </div>
  </figure>`
}
