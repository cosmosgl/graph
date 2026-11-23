import { DEFAULTS, fixture, type Fixture, type Scene, type Settings } from './data'
import { gradientScene } from './gradient-fixtures'
import { PATTERNS } from './patterns'

export type PreviewScene = Fixture | 'gradients' | 'patterns'

export function previewInputs (preset: PreviewScene, blend: boolean): { scene: Scene; settings: Settings } {
  const settings = { ...DEFAULTS, blend, endpointColors: preset === 'gradients' }
  if (preset === 'gradients') return { scene: gradientScene(fixture('ribbons'), 'endpoints'), settings }
  if (preset === 'patterns') {
    const scene = fixture('ribbons')
    scene.links.forEach((link, i) => { link.pattern = PATTERNS[i % PATTERNS.length] })
    return { scene, settings }
  }
  return { scene: fixture(preset), settings }
}

function choice (key: string, label: string, options: string[][]): string {
  const buttons = options.map(([value, text], i) =>
    `<button type="button" value="${value}" aria-pressed="${i === 0}">${text}</button>`)
  return `<div class="choice-control" role="group" aria-label="${label}" data-choice="${key}">
    <span class="choice-label">${label}</span><div class="choice-options">${buttons.join('')}</div></div>`
}

export function linkControls (): string {
  return `<div data-run-part="configuration" class="choice-controls">
    ${choice('fixture', 'Scene', [
    ['ribbons', 'Solid links'], ['overlap', 'Overlap'], ['limits', 'Width limits'], ['boundaries', 'Fractional edges'],
    ['gradients', 'Endpoint colors'], ['patterns', 'Dash and dot gaps'],
  ])}
    ${choice('variant', 'Picking', [['visible', 'Visible stroke'], ['production', 'Cosmos (+5 CSS px)']])}
    ${choice('blend', 'Edges', [['blend', 'Antialiased'], ['hard', 'Hard']])}
  </div>`
}
