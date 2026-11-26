export const linkLanes = ['webgl', 'webgpu'] as const

export function linkChoice (key: string, label: string, options: string[][]): string {
  const buttons = options.map(([value, text], i) =>
    `<button type="button" value="${value}" aria-pressed="${i === 0}">${text}</button>`)
  return `<div class="choice-control" role="group" aria-label="${label}" data-choice="${key}">
    <span class="choice-label">${label}</span><div class="choice-options">${buttons.join('')}</div></div>`
}

export const linkNames = { webgl: 'WebGL', webgpu: 'WebGPU' }

export function linkPanels (width: number, height: number): string {
  return `<div data-run-part="visualization" class="shape-preview">
    <div class="backend-panels styling-panels">${linkLanes.map(lane => `<div class="backend-panel">
      <strong>${linkNames[lane]}</strong>
      <div class="styling-viewport"><canvas data-canvas="${lane}" width="${width}" height="${height}" tabindex="0"
        role="button" aria-pressed="false" aria-label="Pin pixel in ${linkNames[lane]} preview" aria-describedby="link-pixel-help"></canvas>
        <span class="styling-cursor" data-cursor="${lane}" hidden></span></div>
      <p class="styling-pick" data-pick="${lane}"></p><p class="canvas-error" data-error="${lane}" hidden></p>
    </div>`).join('')}</div>
    <p role="status" id="run-results" data-preview-status>Preparing previews…</p>
    <button type="button" data-retry hidden>Retry comparison</button>
    <p class="visually-hidden" data-inspect-feedback aria-live="polite"></p>
    <p class="case-meta" id="link-pixel-help">Arrow keys move one pixel. Enter or Space pins or releases it.</p>
  </div>`
}
