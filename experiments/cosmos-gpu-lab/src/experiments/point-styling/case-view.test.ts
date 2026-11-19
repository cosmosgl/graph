import { expect, it, vi } from 'vitest'
import { createStylingView } from './view'

it('opens each styling case with a focused scene and its own controls', async () => {
  const expected = [
    { id: 'shapes', fixture: 'shapes', visible: '[data-scale]', hidden: '[data-image-filter]', diagnostic: null, excluded: 'atlas-images' },
    { id: 'picking', fixture: 'overlap', visible: '[data-order]', hidden: '[data-image-filter]', diagnostic: 'picking', excluded: 'atlas-images' },
    { id: 'images', fixture: 'atlas-images', visible: '[data-image-filter]', hidden: '[data-effects-profile]', diagnostic: 'images', excluded: 'overlap' },
    { id: 'effects', fixture: 'point-effects', visible: '[data-effects-profile]', hidden: '[data-image-filter]', diagnostic: 'effects', excluded: 'shapes' },
  ]
  for (const item of expected) {
    const host = document.createElement('div'); document.body.append(host)
    const instance = await createStylingView(host, item.id)
    try {
      expect(host.querySelector<HTMLSelectElement>('[data-fixture]')!.value).toBe(item.fixture)
      expect(host.querySelector(`[data-fixture] option[value="${item.excluded}"]`)).toBeNull()
      expect(host.querySelector(item.visible)!.closest('label')!.hidden).toBe(false)
      expect(host.querySelector(item.hidden)!.closest('label')!.hidden).toBe(true)
      for (const section of host.querySelectorAll<HTMLElement>('[data-case-diagnostic]')) {
        expect(section.hidden).toBe(section.dataset.caseDiagnostic !== item.diagnostic)
      }
      if (item.id === 'shapes') {
        const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
        expect(fixture.querySelector<HTMLOptionElement>('[value="fractional"]')!.hidden).toBe(false)
        fixture.value = 'fractional'; fixture.dispatchEvent(new Event('change'))
        await vi.waitFor(() => expect(fixture.disabled).toBe(false), { timeout: 20000 })
        expect(host.querySelector('[data-results]')!.textContent).toContain('Fractional pixel investigation')
      }
      if (item.id === 'picking') {
        const inspect = host.querySelector<HTMLButtonElement>('[data-inspect-center]')!
        expect(inspect.hidden).toBe(false); inspect.click()
        expect(host.querySelector('[data-inspect-feedback]')!.textContent).toContain('WebGL:')
      }
      if (item.id === 'images') {
        const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
        fixture.value = 'atlas-dynamic'; fixture.dispatchEvent(new Event('change'))
        await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[data-image-next]')!.disabled).toBe(false), { timeout: 20000 })
        expect(host.querySelector<HTMLElement>('[data-image-actions]')!.hidden).toBe(false)
      }
      if (item.id === 'effects') expect(host.querySelector<HTMLSelectElement>('[data-effects-scene]')!.value).toBe('overlap')
    } finally { instance.destroy(); host.remove() }
  }
}, 90000)
