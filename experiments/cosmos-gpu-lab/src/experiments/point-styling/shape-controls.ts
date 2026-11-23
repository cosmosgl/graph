import { DEFAULTS, type Settings } from './data'

const scene = {
  key: 'fixture',
  label: 'Scene',
  initial: 'shapes',
  options: [['shapes', '8 shapes'], ['edge-cases', 'Edge cases'], ['fractional', 'Fractional sizes']],
}
const settings = [
  { key: 'renderer', label: 'WebGPU bounds', options: [['explicit', 'Closed'], ['production', 'Half-open (WebGL)']], initial: 'explicit' },
  { key: 'zoom', label: 'Zoom', options: [['0.5', '0.5×'], ['1', '1×'], ['1.35', '1.35×'], ['2', '2×']], initial: String(DEFAULTS.zoom) },
  { key: 'scale', label: 'Size on zoom', options: [['yes', 'Scale'], ['no', 'Constant']], initial: 'yes' },
  { key: 'ratio', label: 'Pixel ratio', options: [['1', '1×'], ['2', '2×']], initial: String(DEFAULTS.ratio) },
  { key: 'opacity', label: 'Opacity', options: [['1', '1'], ['0.35', '0.35']], initial: String(DEFAULTS.opacity) },
]

export function shapeControls (section: 'scene' | 'settings'): string {
  const controls = section === 'scene' ? [scene] : settings
  return controls.map(({ key, label, options, initial }) => {
    const buttons = options.map(([value, text]) =>
      `<button type="button" disabled value="${value}" aria-pressed="${value === initial}">${text}</button>`).join('')
    const visibleLabel = section === 'settings' ? `<span class="choice-label">${label}</span>` : ''
    return `<div class="choice-control" role="group" aria-label="${label}" data-control="${key}">
      ${visibleLabel}<div class="choice-options">${buttons}</div></div>`
  }).join('')
}

export function shapeChoice (host: HTMLElement, key: string): string {
  return host.querySelector<HTMLButtonElement>(`[data-control="${key}"] [aria-pressed="true"]`)!.value
}

export function shapeSettings (host: HTMLElement): Settings {
  return {
    ...DEFAULTS,
    ratio: Number(shapeChoice(host, 'ratio')),
    zoom: Number(shapeChoice(host, 'zoom')),
    scaleOnZoom: shapeChoice(host, 'scale') === 'yes',
    opacity: Number(shapeChoice(host, 'opacity')),
  }
}
