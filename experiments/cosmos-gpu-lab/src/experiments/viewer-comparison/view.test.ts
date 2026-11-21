import { expect, it, vi } from 'vitest'
import '../../app/styles.css'
import { createAppShell } from '../../app/app-shell'
import type { Production } from './production'

it('renders WebGL and WebGPU graphs through resize and data replacement', async () => {
  const original = window.location.href
  const base = document.createElement('base'); base.href = '/'; document.head.prepend(base)
  const host = document.createElement('div'); document.body.append(host)
  window.history.replaceState(null, '', '#/viewer-comparison')
  const shell = createAppShell(host)
  try {
    await vi.waitFor(() => {
      expect(host.querySelector<HTMLButtonElement>('[data-action="run"]')?.disabled).toBe(false)
    }, { timeout: 30000 })
    const frame = host.querySelector<HTMLIFrameElement>('iframe[title="Production Cosmos WebGL graph"]')!
    const candidate = host.querySelector<HTMLCanvasElement>('canvas[data-webgpu]')!
    await vi.waitFor(() => {
      expect((frame.contentWindow as Window & { cosmosProduction?: Promise<Production> }).cosmosProduction).toBeDefined()
    }, { timeout: 15000 })
    const control = await (frame.contentWindow as Window & { cosmosProduction: Promise<Production> }).cosmosProduction
    expect(control.canvas.isConnected).toBe(true)
    for (const element of [frame, candidate]) {
      expect(element.getBoundingClientRect().width).toBeGreaterThan(0)
      expect(element.getBoundingClientRect().height).toBeGreaterThan(0)
      expect(getComputedStyle(element).visibility).toBe('visible')
    }
    expect(control.snapshot().some((value, index) => index % 4 === 3 && value > 0)).toBe(true)

    // Resizing after initialization must keep both displayed and drawing-buffer sizes aligned.
    const initialWidth = frame.getBoundingClientRect().width
    host.style.width = `${Math.max(200, initialWidth - 80)}px`
    await vi.waitFor(() => {
      expect(frame.getBoundingClientRect().width).toBeLessThan(initialWidth)
      expect(Math.abs(frame.getBoundingClientRect().width - candidate.getBoundingClientRect().width)).toBeLessThan(1)
      expect([control.canvas.width, control.canvas.height]).toEqual([candidate.width, candidate.height])
    }, { timeout: 15000 })
    const ratioDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    const originalRatio = window.devicePixelRatio; const testRatio = originalRatio === 1.25 ? 1.5 : 1.25
    try {
      Object.defineProperty(window, 'devicePixelRatio', { value: testRatio, configurable: true })
      window.dispatchEvent(new Event('resize'))
      await vi.waitFor(() => {
        expect(control.canvas.width).toBe(Math.floor(frame.getBoundingClientRect().width * testRatio))
        expect([control.canvas.width, control.canvas.height]).toEqual([candidate.width, candidate.height])
      }, { timeout: 15000 })
    } finally {
      if (ratioDescriptor) Object.defineProperty(window, 'devicePixelRatio', ratioDescriptor)
      else Reflect.deleteProperty(window, 'devicePixelRatio')
      window.dispatchEvent(new Event('resize'))
    }
    await vi.waitFor(() => {
      expect([control.canvas.width, control.canvas.height]).toEqual([candidate.width, candidate.height])
    }, { timeout: 15000 })

    // Check the real candidate's drawn pixels without imposing a color-compatibility verdict.
    const check = host.querySelector<HTMLButtonElement>('[data-action="check"]')!
    await vi.waitFor(() => expect(check.disabled).toBe(false), { timeout: 15000 })
    check.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-results]')!.textContent).toContain('style A')
      expect(check.disabled).toBe(false)
    }, { timeout: 30000 })
    const paint = host.querySelector<HTMLButtonElement>('#run-diagnostics [data-action="paint"]')!
    paint.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-results]')!.textContent).toContain('Same-geometry paint · karate · style A')
      expect(paint.disabled).toBe(false)
    }, { timeout: 30000 })
    const corrected = host.querySelector<HTMLButtonElement>('[data-action="paint-corrected-links"]')!
    corrected.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-results]')!.textContent).toContain('Corrected link paint · karate · style A')
      expect(corrected.disabled).toBe(false)
    }, { timeout: 30000 })
    host.querySelector<HTMLButtonElement>('[data-action="chain"]')!.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-results]')!.textContent).toContain('chain · style A · paused update')
      expect(paint.disabled).toBe(false)
    }, { timeout: 30000 })
    paint.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-results]')!.textContent).toContain('Same-geometry paint · chain · style A')
      expect(paint.disabled).toBe(false)
    }, { timeout: 30000 })
    const capture = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:viewer-test')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    host.querySelector<HTMLButtonElement>('[data-action="export"]')!.click()
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce())
    const result = JSON.parse(await (capture.mock.calls[0][0] as Blob).text())
    expect(result.records.find((row: { action: string }) => row.action === 'updates').candidatePixels.paintedSamples).toBeGreaterThan(0)
    const paints = result.records.filter((row: { action: string }) => row.action === 'same-geometry-paint')
    expect(paints).toHaveLength(3)
    expect(paints[0]).toMatchObject({ scene: 'karate', pointCount: 34, linkCount: 78, nonempty: true })
    expect(paints[1]).toMatchObject({
      scene: 'karate',
      pointCount: 34,
      linkCount: 78,
      nonempty: true,
      smoothLinks: true,
      distanceOpacity: true,
      geometry: paints[0].geometry,
      camera: paints[0].camera,
      samples: paints[0].samples,
      boundarySamples: paints[0].boundarySamples,
    })
    expect(paints[2]).toMatchObject({ scene: 'chain', pointCount: 32, linkCount: 31 })
  } finally {
    vi.restoreAllMocks()
    shell.destroy(); host.remove(); base.remove()
    window.history.replaceState(null, '', original)
  }
}, 60000)
