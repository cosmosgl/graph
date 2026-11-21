import { count } from '../../runtime/result-format'

// The two middle rows are the shorter checks in the benchmark's YouTube capacity section.
const rows = [
  [262144, 'completed', 'completed', 'completed'],
  [524288, 'completed', 'completed', 'no-result'],
  [786432, 'completed', 'no-result', 'no-result'],
  [1000000, 'completed', 'timeout', 'not-reached'],
] as const

/* eslint-disable @typescript-eslint/naming-convention -- Keys are also used as outcome attributes. */
const labels = {
  completed: '<span aria-hidden="true">✓</span><span class="visually-hidden">Completed</span>',
  'no-result': 'No result',
  timeout: '<strong>Timed out</strong>',
  'not-reached': 'Not reached',
}
/* eslint-enable @typescript-eslint/naming-convention */

export function renderYoutubeCapacity (host: HTMLElement): void {
  const results = rows.map(([points, ...outcomes]) => `<tr><th scope="row">${count(points)}</th>
    ${outcomes.map(outcome => `<td data-outcome="${outcome}">${labels[outcome]}</td>`).join('')}</tr>`).join('')
  host.innerHTML = `<figure class="result-chart result-workflow">
    <figcaption>
      <span class="result-chart-title">At one million points, box selection timed out</span>
      <span class="result-chart-context">Production WebGL · Moving layouts · Apple M3</span>
    </figcaption>
    <table class="result-workflow-table">
      <caption class="visually-hidden">Production WebGL checks at four tested YouTube graph sizes</caption>
      <thead><tr><th scope="col">Points</th><th scope="col">Draw &amp; move</th><th scope="col">Box select</th><th scope="col">Polygon select</th></tr></thead>
      <tbody>${results}</tbody>
    </table>
    <div class="result-chart-context result-workflow-note"><span aria-hidden="true">✓</span> Completed · The two middle sizes used short checks.</div>
  </figure>`
}
