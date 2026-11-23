import { linkChoice } from '../../runtime/link-preview'
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

export function linkControls (): string {
  return `<div data-run-part="configuration" class="choice-controls">
    ${linkChoice('fixture', 'Scene', [
    ['ribbons', 'Solid links'], ['overlap', 'Overlap'], ['limits', 'Width limits'], ['boundaries', 'Fractional edges'],
    ['gradients', 'Endpoint colors'], ['patterns', 'Dash and dot gaps'],
  ])}
    ${linkChoice('variant', 'Picking', [['visible', 'Visible stroke'], ['production', 'Cosmos (+5 CSS px)']])}
    ${linkChoice('blend', 'Edges', [['blend', 'Antialiased'], ['hard', 'Hard']])}
  </div>`
}
