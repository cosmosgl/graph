// The slowest click in the original wider run, documented in the pilot findings.
export const originalPickTotalMs = 100.4
export const pickFeedbackTargetMs = 50

const phases = [
  { phase: 'readback', label: 'Request to readback', ms: 3.3 },
  { phase: 'highlight', label: 'Draw highlight to completion', ms: 4.3 },
  { phase: 'wait', label: 'Wait for next animation opportunity', ms: 92.8 },
]

export function renderSelectionTiming (host: HTMLElement): void {
  const target = `${pickFeedbackTargetMs} ms target`
  const total = `${originalPickTotalMs} ms total`
  const positions = phases.map(({ ms }) => `${ms}fr`).join(' ')
  const targetPosition = `${pickFeedbackTargetMs / originalPickTotalMs * 100}%`
  host.innerHTML = `<figure class="result-chart result-pick-timing">
    <figcaption>
      <span class="result-chart-title">Most of the wait came after the highlight was ready</span>
      <span class="result-chart-context">Slowest click in the original wide-window run</span>
      <span class="visually-hidden">${total}. ${target}.</span>
    </figcaption>
    <div class="result-pick-plot" style="--pick-target-position:${targetPosition}" aria-hidden="true">
      <div class="result-pick-axis"><span>0</span><span class="result-pick-target">${target}</span><span>${total}</span></div>
      <div class="result-pick-bar" style="grid-template-columns:${positions}">
        ${phases.map(({ phase }) => `<span data-phase="${phase}"></span>`).join('')}
      </div>
    </div>
    <dl class="result-pick-phases">
      ${phases.map(({ phase, label, ms }) => `<div><span class="result-pick-swatch" data-phase="${phase}" aria-hidden="true"></span>
        <dt>${label}</dt><dd>${ms} ms</dd></div>`).join('')}
    </dl>
  </figure>`
}
