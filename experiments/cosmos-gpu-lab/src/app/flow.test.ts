import { afterEach, describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

const hosts: HTMLElement[] = []

function createHost (): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  return host
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('GPU Lab documentation flows', () => {
  it('renders flow labels as inert text and preserves sibling paths in list order', async () => {
    const host = createHost()
    await renderMarkdown(host, [
      '```flow',
      'Shared input · <img src=x onerror=alert(1)>',
      'WebGL · Blend | WebGPU · Reduce',
      'Compare · A < B && B > C',
      '```',
    ].join('\n'), {}, { linkTerms: false })

    expect(host.querySelector('img, script, [onerror]')).toBeNull()
    const steps = host.querySelectorAll('.doc-flow > li')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toContain('<img src=x onerror=alert(1)>')
    expect(Array.from(steps[1].querySelectorAll('ul > li'), item => item.textContent))
      .toEqual(['WebGL Blend', 'WebGPU Reduce'])
    expect(steps[2].textContent).toContain('A < B && B > C')
  })

  it('offers a keyboard-accessible definition inside a flow without leaving the page', async () => {
    const host = createHost()
    await renderMarkdown(host, '```flow\nInput\nCompute shader · Process the input\nResult\n```')
    const trigger = host.querySelector<HTMLButtonElement>('.doc-flow .vocabulary-term-link')!
    expect(trigger.textContent).toBe('Compute shader')
    trigger.focus()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Compute shader')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('#/vocabulary/compute-shader')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
