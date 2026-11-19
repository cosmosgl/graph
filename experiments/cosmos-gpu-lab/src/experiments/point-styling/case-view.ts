export type StylingCaseId = 'shapes' | 'picking' | 'images' | 'effects'

type CasePresentation = { fixture: string; fixtures: string[]; controls: string[]; diagnostics: string[] }

const presentations: Record<StylingCaseId, CasePresentation> = {
  shapes: {
    fixture: 'shapes',
    fixtures: ['shapes', 'edge-cases', 'fractional'],
    controls: ['renderer', 'fixture', 'zoom', 'ratio', 'scale'],
    diagnostics: [],
  },
  picking: {
    fixture: 'overlap',
    fixtures: ['overlap', 'shapes', 'edge-cases', 'tiny-alpha', 'tiny-overlap', 'alpha-stack'],
    controls: ['renderer', 'fixture', 'opacity', 'order', 'zoom', 'ratio', 'scale'],
    diagnostics: ['picking'],
  },
  images: {
    fixture: 'atlas-images',
    fixtures: ['atlas-images', 'atlas-shapes', 'atlas-overlap', 'atlas-edges', 'atlas-decoding', 'atlas-dynamic',
      'atlas-packing-grid', 'atlas-packing-edges', 'atlas-packing-overlap'],
    controls: ['renderer', 'fixture', 'image-filter', 'atlas-isolation', 'zoom', 'ratio', 'scale', 'opacity', 'order'],
    diagnostics: ['images'],
  },
  effects: {
    fixture: 'point-effects',
    fixtures: ['point-effects'],
    controls: ['renderer', 'effects-scene', 'effects-profile', 'overlay-arithmetic', 'polygon-arithmetic', 'zoom', 'ratio', 'scale', 'opacity', 'order'],
    diagnostics: ['effects'],
  },
}

export function stylingCaseId (requested?: string): StylingCaseId {
  return requested && Object.hasOwn(presentations, requested) ? requested as StylingCaseId : 'shapes'
}

export function refreshStylingCase (host: HTMLElement, id: StylingCaseId): void {
  const presentation = presentations[id]
  const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
  for (const label of host.querySelectorAll<HTMLLabelElement>('.styling-toolbar label')) {
    const select = label.querySelector<HTMLSelectElement>('select')
    if (!select) continue
    const key = Object.keys(select.dataset)[0]?.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`) ?? ''
    let visible = presentation.controls.includes(key)
    if (id === 'images' && key === 'atlas-packing') visible = !['atlas-dynamic', 'atlas-decoding'].includes(fixture.value)
    if (id === 'images' && key === 'decode-policy') visible = fixture.value === 'atlas-decoding'
    label.hidden = !visible
  }
  const imageUpdates = fixture.value === 'atlas-dynamic'
  host.querySelector<HTMLElement>('[data-image-actions]')!.hidden = id !== 'images' || !imageUpdates
  host.querySelector<HTMLElement>('[data-image-stage]')!.hidden = id !== 'images' || !['atlas-dynamic', 'atlas-decoding'].includes(fixture.value)
  host.querySelector<HTMLElement>('[data-inspect-center]')!.hidden = id !== 'picking'
  for (const section of host.querySelectorAll<HTMLElement>('[data-case-diagnostic]')) {
    section.hidden = !presentation.diagnostics.includes(section.dataset.caseDiagnostic!)
  }
  const diagnostics = host.querySelector<HTMLElement>('#run-diagnostics')
  if (diagnostics) diagnostics.hidden = presentation.diagnostics.length === 0
}

export function initializeStylingCase (host: HTMLElement, id: StylingCaseId): void {
  const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
  // Hidden native options can still be announced by assistive technology.
  // Each case has its own view instance, so remove unrelated options entirely.
  for (const option of Array.from(fixture.options)) {
    if (!presentations[id].fixtures.includes(option.value)) option.remove()
  }
  fixture.value = presentations[id].fixture
  // The overlap scene avoids making the known polygon-boundary failure the
  // first example, while the unchanged boundary control remains selectable.
  if (id === 'effects') host.querySelector<HTMLSelectElement>('[data-effects-scene]')!.value = 'overlap'
  refreshStylingCase(host, id)
}
