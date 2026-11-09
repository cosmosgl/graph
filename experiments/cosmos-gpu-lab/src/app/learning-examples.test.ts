import { afterEach, describe, expect, it } from 'vitest'
import source from '../docs/learn-webgpu.md?raw'
import { addLearningContents, learningExamples } from './learning-examples'
import { renderMarkdown } from './markdown'

let host: HTMLDivElement | undefined
const initialUrl = window.location.href
async function mount (): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.append(host)
  await renderMarkdown(host, source, {}, { examples: learningExamples })
  return host
}
function click (root: Element, text: string): void {
  const target = Array.from(root.querySelectorAll('button')).find(node => node.textContent === text)
  if (!target) throw new Error(`Missing button: ${text}`)
  target.click()
}
function select (node: HTMLSelectElement, value: string): void {
  node.value = value
  node.dispatchEvent(new Event('change', { bubbles: true }))
}
afterEach(() => {
  host?.remove()
  window.history.replaceState(window.history.state, '', initialUrl)
})

describe('WebGPU learning guide', () => {
  it('opens a deep-linked chapter and keeps example state when jumping within the guide', async () => {
    const page = await mount()
    addLearningContents(page, '8')
    expect(document.activeElement?.id).toBe('learn-8')
    const example = page.querySelector('[data-doc-example="pingPong"]')!
    click(example, 'Advance tick')
    page.querySelector<HTMLAnchorElement>('a[href="#/learn/3"]')!.click()
    expect(document.activeElement?.id).toBe('learn-3')
    expect(window.location.hash).toBe('#/learn/3')
    page.querySelector<HTMLAnchorElement>('a[href="#/learn/8"]')!.click()
    expect(document.activeElement?.id).toBe('learn-8')
    expect(example.textContent).toContain('Tick 1 complete')
    page.querySelector<HTMLAnchorElement>('#learn-8 + .learning-back')!.click()
    expect(page.querySelector<HTMLDetailsElement>('.learning-contents')?.open).toBe(true)
    expect(document.activeElement?.tagName).toBe('SUMMARY')
    expect(window.location.hash).toBe('#/learn')
    expect(example.textContent).toContain('Tick 1 complete')
  })

  it('mounts the authored examples and explains the tail after changing dispatch dimensions', async () => {
    const page = await mount()
    expect(page.querySelectorAll('.learning-example')).toHaveLength(5)
    expect(page.querySelector('.code-block-wgsl')).not.toBeNull()
    expect(page.querySelector('.vocabulary-term-link')).not.toBeNull()
    const example = page.querySelector('[data-doc-example="invocations"]')!
    click(example, '10')
    expect(example.querySelector('[role="status"]')?.textContent).toContain('return without accessing a buffer')
    expect(example.querySelectorAll('.is-selected')).toHaveLength(0)
    select(example.querySelectorAll('select')[1], '8')
    click(example, '5')
    expect(example.querySelector('[role="status"]')?.textContent).toContain('Global 5 = group 0 × 8 + local 5')
    expect(example.querySelectorAll('.is-selected')).toHaveLength(2)
    select(example.querySelectorAll('select')[0], '1')
    click(example, '0')
    expect(example.querySelector('[role="status"]')?.textContent).toContain('Read A[0], write B[0]')
  })

  it('swaps current positions between physical buffers and resets both', async () => {
    const page = await mount()
    const example = page.querySelector('[data-doc-example="pingPong"]')!
    const values = (): string[] => Array.from(example.querySelectorAll('.learning-cell'), node => node.textContent!)
    click(example, 'Advance tick')
    expect(values()).toEqual(['0', '2', '4', '6', '1', '3', '5', '7'])
    expect(example.textContent).toContain('Draw B')
    click(example, 'Advance tick')
    expect(values()).toEqual(['2', '4', '6', '8', '1', '3', '5', '7'])
    expect(example.textContent).toContain('Draw A')
    click(example, 'Reset buffers')
    expect(values()).toEqual(['0', '2', '4', '6', '0', '0', '0', '0'])
  })

  it('preserves the reduction sum and packed membership when every point occupies one cell', async () => {
    const page = await mount()
    const reduction = page.querySelector('[data-doc-example="reduction"]')!
    click(reduction, 'Combine pairs')
    click(reduction, 'Combine pairs')
    click(reduction, 'Combine pairs')
    expect(reduction.querySelector('[role="status"]')?.textContent).toContain('Result: 24')
    expect(reduction.querySelector('button')?.disabled).toBe(true)
    click(reduction, 'Reset reduction')
    expect(reduction.querySelectorAll('.learning-buffer')).toHaveLength(1)
    const grid = page.querySelector('[data-doc-example="grid"]')!
    for (const node of grid.querySelectorAll('select')) select(node, '1')
    const rows = grid.querySelectorAll('.learning-buffer')
    const values = (row: Element): string[] => Array.from(row.querySelectorAll('.learning-cell'), node => node.textContent!)
    expect(values(rows[0])).toEqual(['0', '5', '0'])
    expect(values(rows[1])).toEqual(['0', '0', '5', '5'])
    expect(values(rows[2])).toEqual(['0', '1', '2', '3', '4'])
    expect(grid.textContent).toContain('Cell 0: [0, 0) → empty')
  })

  it('updates the circle footprint while preserving its center and falls back safely for unknown examples', async () => {
    const page = await mount()
    const example = page.querySelector('[data-doc-example="rendering"]')!
    click(example, '3 · Circle coverage')
    select(example.querySelector('select')!, '65')
    expect(example.querySelector('.learning-disc')?.getAttribute('r')).toBe('65')
    expect(example.querySelector('.learning-disc')?.getAttribute('cx')).toBe('100')
    expect(example.querySelector('button[aria-pressed="true"]')?.textContent).toBe('3 · Circle coverage')
    await renderMarkdown(page, '```example\n<img src=x onerror=alert(1)>\n```', {}, { examples: learningExamples })
    expect(page.querySelector('img')).toBeNull()
    expect(page.querySelector('pre')?.textContent).toContain('<img')
  })
})
