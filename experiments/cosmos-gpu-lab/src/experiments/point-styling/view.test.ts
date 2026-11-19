import { afterEach, expect, it, vi } from 'vitest'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createStylingView } from './view'
import { SHAPES, type Settings } from './data'
import type { PolygonAudit } from './polygon-audit'
import type { ColorComparison, Comparison } from './reference'
import type { EffectsRow } from './effects-study'

let host: HTMLElement | undefined
let instance: ExperimentInstance | undefined
afterEach(() => { instance?.destroy(); host?.remove() })

it('exposes decoded-source failures and restores the selected path after cancellation', async () => {
  host = document.createElement('div'); document.body.append(host); instance = await createStylingView(host, 'images')
  const select = async (selector: string, value: string): Promise<void> => {
    const control = host!.querySelector<HTMLSelectElement>(selector)!
    control.value = value; control.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(control.disabled).toBe(false), { timeout: 20000 })
  }
  await select('[data-fixture]', 'atlas-decoding')
  const decoder = host.querySelector<HTMLSelectElement>('[data-decode-policy]')!
  expect(decoder.value).toBe('normalized-premultiplied')
  expect(host.querySelector('[data-decode-audit]')!.textContent).not.toContain('Fail')
  const canvas = host.querySelector<HTMLCanvasElement>('canvas')!
  await select('[data-decode-policy]', 'flipped')
  expect(host.querySelector('[data-decode-audit]')!.textContent).toContain('Fail')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Decoded source/input color check failed')
  await select('[data-renderer]', 'production')
  expect(decoder.disabled).toBe(true)
  expect(host.querySelector('[data-decode-audit]')!.textContent).not.toContain('Fail')
  expect(host.querySelector('[role="status"]')!.textContent).not.toContain('Decoded source/input color check failed')
  await select('[data-renderer]', 'eligibility')
  expect(decoder.value).toBe('flipped')
  expect(host.querySelector('[data-decode-audit]')!.textContent).toContain('Fail')
  await select('[data-decode-policy]', 'normalized-premultiplied')
  host.querySelector<HTMLButtonElement>('[data-decoding-sweep]')!.click()
  await vi.waitFor(() => expect(host!.querySelectorAll('[data-decoding-table] tbody tr').length).toBeGreaterThan(0), { timeout: 20000 })
  host.querySelector<HTMLButtonElement>('[data-decoding-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-decoding-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
  expect(host.querySelectorAll('[data-decoding-table] tbody tr').length).toBeLessThan(56)
  expect(host.querySelector('canvas')).toBe(canvas); expect([canvas.width, canvas.height]).toEqual([512, 320])
  expect(decoder.value).toBe('normalized-premultiplied')
  await select('[data-image-filter]', 'linear')
  expect(host.querySelector('[data-decode-audit]')!.textContent).not.toContain('Fail')
  expect(host.querySelector('[data-isolation-audit]')!.textContent).not.toContain('Fail')
  await select('[data-fixture]', 'atlas-images')
  expect(decoder.disabled).toBe(true); expect(host.querySelector('details')).toBeNull()
}, 90000)

it('steps live image updates and preserves image state and canvases across sweep cancellation', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host, 'images')
  const select = host.querySelector<HTMLSelectElement>('[data-fixture]')!
  select.value = 'atlas-dynamic'; select.dispatchEvent(new Event('change'))
  await vi.waitFor(() => expect(select.disabled).toBe(false), { timeout: 20000 })
  expect(host.querySelector<HTMLSelectElement>('[data-renderer]')!.value).toBe('eligibility')
  expect(host.querySelector<HTMLSelectElement>('[data-atlas-isolation]')!.value).toBe('texel')
  const canvas = host.querySelector<HTMLCanvasElement>('canvas')!
  const next = host.querySelector<HTMLButtonElement>('[data-image-next]')!
  for (let i = 0; i < 2; i++) {
    next.click(); await vi.waitFor(() => expect(next.disabled).toBe(false), { timeout: 20000 })
  }
  const imageState = host.querySelector('[data-image-stage]')!.textContent
  expect(imageState).toContain('Make image 0 transparent')
  const inspect = (): void => {
    const box = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: box.left + box.width * 130.5 / 512,
      clientY: box.top + box.height * 200.5 / 320,
    }))
    expect(host!.querySelector('[data-pick="webgl"]')!.textContent).toContain('point 0')
    expect(host!.querySelector('[data-pick="webgpu"]')!.textContent).toContain('point 0')
  }
  inspect()
  host.querySelector<HTMLButtonElement>('[data-dynamic-sweep]')!.click()
  expect(next.disabled).toBe(true)
  await vi.waitFor(() => expect(host!.querySelectorAll('[data-dynamic-table] tbody tr').length).toBeGreaterThan(0), { timeout: 20000 })
  host.querySelector<HTMLButtonElement>('[data-dynamic-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-dynamic-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
  expect(host.querySelectorAll('[data-dynamic-table] tbody tr').length).toBeLessThan(72)
  expect(host.querySelector('[data-image-stage]')!.textContent).toBe(imageState)
  expect(host.querySelector('canvas')).toBe(canvas); expect([canvas.width, canvas.height]).toEqual([512, 320])
  next.click(); await vi.waitFor(() => expect(next.disabled).toBe(false), { timeout: 20000 })
  inspect()
  expect(host.querySelector('[data-isolation-audit]')!.textContent).not.toContain('Fail')
  expect(host.querySelector('details')).toBeNull()
}, 90000)

it('exposes source-texel addressing and retains the clamped control verdict', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host, 'images')
  const select = async (selector: string, value: string): Promise<void> => {
    const element = host!.querySelector<HTMLSelectElement>(selector)!
    element.value = value; element.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.disabled).toBe(false), { timeout: 20000 })
  }
  await select('[data-fixture]', 'atlas-packing-edges'); await select('[data-renderer]', 'eligibility')
  await select('[data-atlas-isolation]', 'clamp')
  const control = host.querySelector('[data-isolation-audit]')!.textContent
  await select('[data-atlas-isolation]', 'texel')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Source-byte frame passed')
  expect(host.querySelector('[data-isolation-audit]')!.textContent).not.toContain('Fail')
  expect(host.querySelector('[data-atlas-cpu]')!.textContent).not.toContain('Fail')
  expect(host.querySelector('[data-color-preservation]')!.textContent).not.toContain('Fail')
  await select('[data-atlas-isolation]', 'clamp')
  expect(host.querySelector('[data-isolation-audit]')!.textContent).toBe(control)
  expect(host.querySelector('details')).toBeNull()
})

it('keeps non-square atlas settings and live canvases when cancelling the packing sweep', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host, 'images')
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
  instance = await createStylingView(host, 'images')
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
  instance = await createStylingView(host, 'picking')
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
  instance = await createStylingView(host, 'images')
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

it('keeps ring boundary failures visible and preserves the selected scene across sweep cancellation', async () => {
  type Report = {
    polygonAudit: PolygonAudit; comparison: Comparison; compatibility: Comparison; renderer: string; settings: Settings;
    effects: { scene: string; profile: string; cpuColors: Record<'webgl' | 'webgpu', ColorComparison> };
    colorPreservation: Record<'webgl' | 'webgpu', ColorComparison>;
    effectsSweep?: { status: string; finishedAt?: string; rows: EffectsRow[] };
  }
  let exported: Blob | undefined
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    host = document.createElement('div'); document.body.append(host); instance = await createStylingView(host, 'effects')
    const select = async (selector: string, value: string): Promise<void> => {
      const control = host!.querySelector<HTMLSelectElement>(selector)!
      control.value = value; control.dispatchEvent(new Event('change'))
      await vi.waitFor(() => expect(control.disabled).toBe(false), { timeout: 20000 })
    }
    const readReport = async (): Promise<Report> => {
      const button = host!.querySelector<HTMLButtonElement>('[data-export]')!
      expect(button.disabled).toBe(false); exported = undefined; button.click()
      expect(exported).toBeDefined()
      return JSON.parse(await exported!.text()) as Report
    }
    const cells = (selector: string): string[][] => Array.from(host!.querySelectorAll(selector),
      row => Array.from(row.children, cell => cell.textContent ?? ''))
    const checkCpuColors = (report: Report): void => {
      expect(cells('[data-effects-cpu] tbody tr')).toEqual((['webgl', 'webgpu'] as const).map(lane => {
        const colors = report.effects.cpuColors[lane]
        return [lane, String(colors.budgetFailures), `${colors.maxChannelError}/255`, colors.budgetFailures === 0 ? 'Pass' : 'Fail']
      }))
    }
    const checkAudit = async (arithmetic: PolygonAudit['arithmetic']): Promise<Report> => {
      const report = await readReport()
      expect(report.polygonAudit.arithmetic).toBe(arithmetic)
      // Check the whole displayed sequence against computed evidence, not one
      // GPU's historical mismatch count. No pixel acceptance rule changes here.
      const id = (value: number | null): string => value === null ? 'Background' : String(value)
      expect(cells('[data-polygon-audit] tbody tr').map(row => row.slice(0, 2))).toEqual(report.polygonAudit.samples.map(sample => [
        `(${sample.x}, ${sample.y}) · ${SHAPES[sample.shape]} · ${sample.point}`,
        `${id(sample.expected)} / ${id(sample.webgl)} / ${id(sample.webgpu)}`,
      ]))
      checkCpuColors(report)
      return report
    }
    await select('[data-effects-scene]', 'shapes')
    expect(host.querySelector<HTMLSelectElement>('[data-renderer]')!.value).toBe('eligibility')
    const rejected = await checkAudit('normalized')
    // Non-vacuous rejection check: the deliberately rejected fixture must not
    // become accepted merely because its diagnostic row count varies by GPU.
    expect(rejected.comparison.valid).toBe(false)
    expect(host.querySelector('[role="status"]')!.textContent).toContain('not accepted')
    await select('[data-polygon-arithmetic]', 'pixels')
    const pixelReport = await checkAudit('pixels')
    expect(pixelReport.settings.polygonArithmetic).toBe('pixels')
    expect(pixelReport.comparison.valid).toBe(false)
    expect(host.querySelector('[role="status"]')!.textContent).toContain('not accepted')
    await select('[data-renderer]', 'production')
    expect(host.querySelector<HTMLSelectElement>('[data-polygon-arithmetic]')!.disabled).toBe(true)
    expect((await checkAudit('normalized')).renderer).toBe('production')
    await select('[data-renderer]', 'eligibility')
    expect((await checkAudit('pixels')).polygonAudit).toEqual(pixelReport.polygonAudit)
    await select('[data-effects-profile]', '1')
    await select('[data-ratio]', '2')
    const retina = await checkAudit('pixels')
    expect(retina.settings.ratio).toBe(2)
    const preservationFailed = Object.values(retina.colorPreservation).some(result => result.changedPixels > 0)
    expect(host.querySelector('[role="status"]')!.textContent!.includes('Failed color-preservation')).toBe(preservationFailed)
    await select('[data-ratio]', '1')
    await select('[data-effects-scene]', 'overlap')
    await select('[data-effects-profile]', '4')
    expect(host.querySelector<HTMLSelectElement>('[data-opacity]')!.value).toBe('0')
    const selected = await readReport()
    expect(selected.comparison.valid).toBe(true)
    const selectedStatus = host.querySelector('[role="status"]')!.textContent!
    if (selected.compatibility.colorFailures > 0) {
      expect(selectedStatus).toContain('Source-byte frame passed. Production color compatibility failed')
    } else {
      expect(selectedStatus).toContain(`Source-byte candidate passed. Production compatibility ${
        selected.compatibility.valid ? 'passed' : 'differs'}`)
    }
    const canvas = host.querySelector('canvas')!
    host.querySelector<HTMLButtonElement>('[data-effects-sweep]')!.click()
    await vi.waitFor(() => expect(host!.querySelectorAll('[data-effects-table] tbody tr').length).toBeGreaterThan(0), { timeout: 20000 })
    const completed = cells('[data-effects-table] tbody tr')
    host.querySelector<HTMLButtonElement>('[data-effects-cancel]')!.click()
    await vi.waitFor(() => expect(host!.querySelector('[data-effects-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
    const retained = cells('[data-effects-table] tbody tr')
    // A row already in flight may finish; every previously completed row stays.
    expect(retained.length).toBeGreaterThanOrEqual(completed.length)
    expect(retained.slice(0, completed.length)).toEqual(completed)
    const cancelled = await readReport()
    expect(cancelled.effectsSweep!.status).toBe('cancelled'); expect(cancelled.effectsSweep!.finishedAt).toBeTruthy()
    expect(cancelled.effectsSweep!.rows).toHaveLength(retained.length)
    expect(retained.map(row => row.slice(1))).toEqual(cancelled.effectsSweep!.rows.map(row => [
      row.passed ? 'Pass' : 'Fail', String(row.paired.idDisagreements),
      `${row.paired.webglReferenceFailures} / ${row.paired.webgpuReferenceFailures}`,
      `${row.colors.webgl.budgetFailures} / ${row.colors.webgpu.budgetFailures}`,
      `${row.preservation.webgl.changedPixels} / ${row.preservation.webgpu.changedPixels}`,
      row.compatibility.valid ? 'Pass' : 'Fail',
    ]))
    expect(cancelled.effects).toEqual(selected.effects); expect(cancelled.settings).toEqual(selected.settings)
    expect(cancelled.comparison).toEqual(selected.comparison)
    expect(host.querySelector<HTMLSelectElement>('[data-effects-scene]')!.value).toBe('overlap')
    expect(host.querySelector<HTMLSelectElement>('[data-effects-profile]')!.value).toBe('4')
    expect(host.querySelector<HTMLSelectElement>('[data-polygon-arithmetic]')!.value).toBe('pixels')
    expect(host.querySelector('canvas')).toBe(canvas)
    await select('[data-effects-profile]', '0')
    checkCpuColors(await readReport())
    expect(host.querySelector('details')).toBeNull()
  } finally { createUrl.mockRestore(); revokeUrl.mockRestore(); download.mockRestore() }
}, 90000)
