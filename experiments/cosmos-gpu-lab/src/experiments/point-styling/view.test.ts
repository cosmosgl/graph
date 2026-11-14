import { afterEach, expect, it, vi } from 'vitest'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createStylingView } from './view'

let host: HTMLElement | undefined
let instance: ExperimentInstance | undefined
afterEach(() => { instance?.destroy(); host?.remove() })

it('keeps non-square atlas settings and live canvases when cancelling the packing sweep', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host)
  const select = async (selector: string, value: string): Promise<void> => {
    const element = host!.querySelector<HTMLSelectElement>(selector)!
    element.value = value; element.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.disabled).toBe(false), { timeout: 20000 })
  }
  await select('[data-fixture]', 'atlas-packing-grid')
  expect(host.querySelector<HTMLSelectElement>('[data-atlas-packing]')!.value).toBe('npot-square')
  await select('[data-renderer]', 'eligibility'); await select('[data-atlas-packing]', 'npot-rectangle')
  await select('[data-atlas-isolation]', 'clamp')
  const canvas = host.querySelector('canvas')!
  host.querySelector<HTMLButtonElement>('[data-packing-sweep]')!.click()
  expect(host.querySelector<HTMLButtonElement>('[data-isolation-sweep]')!.disabled).toBe(true)
  host.querySelector<HTMLButtonElement>('[data-packing-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-packing-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
  expect(host.querySelectorAll('[data-packing-table] tbody tr')).toHaveLength(1)
  expect(host.querySelector<HTMLSelectElement>('[data-atlas-packing]')!.value).toBe('npot-rectangle')
  expect(host.querySelector<HTMLSelectElement>('[data-fixture]')!.value).toBe('atlas-packing-grid')
  expect(host.querySelector('canvas')).toBe(canvas)
  await select('[data-opacity]', '0')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Source-byte candidate passed')
  expect(host.querySelector('[data-isolation-audit]')!.textContent).not.toContain('Fail')
  expect(host.querySelector('details')).toBeNull()
})

it('labels tile isolation separately and preserves the selected policy after cancellation', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host)
  const select = async (selector: string, value: string): Promise<void> => {
    const element = host!.querySelector<HTMLSelectElement>(selector)!
    element.value = value; element.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.disabled).toBe(false), { timeout: 20000 })
  }
  await select('[data-fixture]', 'atlas-edges'); await select('[data-renderer]', 'eligibility')
  expect(host.querySelector('[data-isolation-audit]')!.textContent).toContain('Fail')
  await select('[data-atlas-isolation]', 'clamp')
  expect(host.querySelector('[data-isolation-audit]')!.textContent).not.toContain('Fail')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Production compatibility differs')
  const canvas = host.querySelector('canvas')!
  host.querySelector<HTMLButtonElement>('[data-isolation-sweep]')!.click()
  expect(host.querySelector<HTMLButtonElement>('[data-atlas-sweep]')!.disabled).toBe(true)
  expect(host.querySelector<HTMLButtonElement>('[data-tiny-sweep]')!.disabled).toBe(true)
  host.querySelector<HTMLButtonElement>('[data-isolation-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-isolation-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
  expect(host.querySelectorAll('[data-isolation-table] tbody tr')).toHaveLength(1)
  expect(host.querySelector<HTMLSelectElement>('[data-atlas-isolation]')!.value).toBe('clamp')
  expect(host.querySelector('canvas')).toBe(canvas)
  expect(host.querySelector('details')).toBeNull()
})

it('shows the image verdict at startup and keeps the same run when inspecting a pixel', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-run-summary-value="passed"]')?.textContent).toContain('1 / 1'))
  const canvas = host.querySelector<HTMLCanvasElement>('canvas')!; const box = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + 20, clientY: box.top + 20 }))
  expect(host.querySelectorAll('.run-layout')).toHaveLength(1)
  expect(host.querySelector('canvas')).toBe(canvas)
  expect(host.querySelector('[data-pick]')!.textContent).toContain('Pixel')
  expect(host.querySelector('details')).toBeNull()
})

it('labels candidate geometry separately from production compatibility and replays the boundary pixels', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host)
  const canvas = host.querySelector('canvas')!
  const select = async (selector: string, value: string): Promise<void> => {
    const element = host!.querySelector<HTMLSelectElement>(selector)!
    element.value = value; element.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.disabled).toBe(false), { timeout: 20000 })
  }
  await select('[data-fixture]', 'fractional'); await select('[data-renderer]', 'explicit'); await select('[data-ratio]', '2')
  expect(host.querySelector('canvas')).toBe(canvas)
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Explicit candidate passed')
  const rows = host.querySelectorAll('[data-boundary-replay] tbody tr')
  expect(rows).toHaveLength(6)
  rows.forEach((row, i) => expect(row.children[2].textContent).toBe(`${[2, 2, 4, 4, 6, 6][i]} / ${[2, 2, 4, 4, 6, 6][i]}`))
  expect(host.querySelector('[data-production-comparison]')!.textContent).toContain('Production WebGL ↔ explicit WebGPU')
  expect(host.querySelector('details')).toBeNull()
  await select('[data-opacity]', '0')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Explicit candidate passed')
  expect(host.querySelector('[data-picking-rule]')!.textContent).toContain('visible')
  rows.forEach(row => expect(row.isConnected).toBe(false))
  host.querySelectorAll('[data-boundary-replay] tbody tr').forEach(row => {
    expect(row.children[2].textContent).toBe('background / background')
    expect(row.children[3].textContent).toBe('background'); expect(row.children[4].textContent).toBe('0 / 0')
  })
  await select('[data-renderer]', 'production')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Failed visibility control')
  expect(host.querySelector('[data-picking-rule]')!.textContent).toContain('legacy')
})

it('keeps invisible foreground rejection visible and cancels a sweep without changing the live canvas', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host)
  const canvas = host.querySelector('canvas')!
  const select = async (selector: string, value: string): Promise<void> => {
    const element = host!.querySelector<HTMLSelectElement>(selector)!
    element.value = value; element.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.disabled).toBe(false), { timeout: 20000 })
  }
  await select('[data-renderer]', 'explicit'); await select('[data-fixture]', 'tiny-overlap')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Failed contribution check')
  expect(host.querySelector('[data-contribution-audit]')!.textContent).toContain('composed alpha 255')
  expect(host.querySelector('[data-run-summary-value="failed"]')!.textContent).toContain('failed')
  host.querySelector<HTMLButtonElement>('[data-tiny-sweep]')!.click()
  host.querySelector<HTMLButtonElement>('[data-tiny-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-tiny-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
  expect(host.querySelectorAll('[data-tiny-alpha-table] tbody tr')).toHaveLength(1)
  expect(host.querySelector('canvas')).toBe(canvas)
  expect((canvas as HTMLCanvasElement).width).toBe(512)
  expect(host.querySelector<HTMLSelectElement>('[data-fixture]')!.value).toBe('tiny-overlap')
  await select('[data-renderer]', 'quantized')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Quantized candidate passed')
  expect(host.querySelector('[data-picking-rule]')!.textContent).toContain('source-alpha')
  host.querySelectorAll('[data-contribution-audit] tbody tr').forEach(row => {
    expect(row.children[1].textContent).toBe('0'); expect(row.children[2].textContent).toBe('0')
  })
  expect(host.querySelector('[data-production-comparison]')!.textContent).toContain('Production WebGL ↔ quantized WebGPU')
  await select('[data-renderer]', 'eligibility')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Source-byte candidate passed')
  expect(host.querySelector('[data-picking-rule]')!.textContent).toContain('original alpha and blending')
  host.querySelectorAll('[data-color-preservation] tbody tr').forEach(row => {
    expect(row.children[1].textContent).toBe('0'); expect(row.children[2].textContent).toBe('0/255')
  })
  expect(host.querySelector('[data-production-comparison]')!.textContent).toContain('Production WebGL ↔ source-byte WebGPU')
  await select('[data-renderer]', 'explicit')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Failed contribution check')
})

it('shows atlas checks and retains a cancelled row without changing the live fixture', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host)
  const select = async (selector: string, value: string): Promise<void> => {
    const element = host!.querySelector<HTMLSelectElement>(selector)!
    element.value = value; element.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.disabled).toBe(false), { timeout: 20000 })
  }
  await select('[data-fixture]', 'atlas-overlap'); await select('[data-renderer]', 'eligibility')
  await select('[data-image-filter]', 'linear')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Source-byte candidate passed')
  host.querySelectorAll('[data-atlas-cpu] tbody tr').forEach(row => expect(row.children[1].textContent).toBe('0'))
  host.querySelectorAll('[data-color-preservation] tbody tr').forEach(row => expect(row.children[1].textContent).toBe('0'))
  const canvas = host.querySelector('canvas')!
  host.querySelector<HTMLButtonElement>('[data-atlas-sweep]')!.click()
  host.querySelector<HTMLButtonElement>('[data-atlas-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-atlas-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
  expect(host.querySelectorAll('[data-atlas-table] tbody tr')).toHaveLength(1)
  expect(host.querySelector('canvas')).toBe(canvas)
  expect(host.querySelector<HTMLSelectElement>('[data-fixture]')!.value).toBe('atlas-overlap')
  expect(host.querySelector<HTMLSelectElement>('[data-image-filter]')!.value).toBe('linear')
  expect(host.querySelector('details')).toBeNull()
})
