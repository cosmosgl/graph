import { expect, it, vi } from 'vitest'
import '../../app/styles.css'
import { createAppShell } from '../../app/app-shell'
import type { Production } from './production'

it('shows real graphs on load and keeps the viewer working after reference navigation', async () => {
  const original = window.location.href
  const moveBefore = Object.getOwnPropertyDescriptor(Element.prototype, 'moveBefore')
  const canPark = typeof Element.prototype.moveBefore === 'function'
  let releaseFrame = (): void => {}
  const base = document.createElement('base'); base.href = '/'; document.head.prepend(base)
  const host = document.createElement('div'); document.body.append(host)
  window.history.replaceState(null, '', '#/viewer-comparison')
  const shell = createAppShell(host)
  try {
    await vi.waitFor(() => {
      expect(host.querySelector<HTMLButtonElement>('[data-action="run"]')?.disabled).toBe(false)
      expect(host.querySelector('[data-study-status]')).toBeNull()
    }, { timeout: 30000 })
    if (!canPark) expect(host.querySelector('[data-restart-note]')?.textContent).toContain('opening a reference restarts the graphs')
    const frame = host.querySelector<HTMLIFrameElement>('iframe[title="Unchanged production Cosmos WebGL viewer"]')!
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
    expect(host.querySelector('#recorded-findings')!.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(host.querySelector('[data-panels]')!.getBoundingClientRect().bottom)
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
        expect(host.querySelector('[data-run-part="status"]')?.textContent).toContain(`DPR ${testRatio}`)
        expect(control.canvas.width).toBe(Math.floor(frame.getBoundingClientRect().width * testRatio))
        expect([control.canvas.width, control.canvas.height]).toEqual([candidate.width, candidate.height])
      }, { timeout: 15000 })
    } finally {
      if (ratioDescriptor) Object.defineProperty(window, 'devicePixelRatio', ratioDescriptor)
      else Reflect.deleteProperty(window, 'devicePixelRatio')
      window.dispatchEvent(new Event('resize'))
    }
    await vi.waitFor(() => {
      expect(host.querySelector('[data-run-part="status"]')?.textContent).toContain(`DPR ${originalRatio}`)
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
    const paint = host.querySelector<HTMLButtonElement>('[data-action="paint"]')!
    paint.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-results]')!.textContent).toContain('Same-geometry paint · karate · style A')
      expect(paint.disabled).toBe(false)
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
    expect(result.records.filter((row: { action: string }) => row.action === 'same-geometry-paint')
      .map(({ scene, pointCount, linkCount }: { scene: string; pointCount: number; linkCount: number }) => ({ scene, pointCount, linkCount })))
      .toEqual([{ scene: 'karate', pointCount: 34, linkCount: 78 }, { scene: 'chain', pointCount: 32, linkCount: 31 }])

    host.querySelector<HTMLButtonElement>('[data-action="run"]')!.click()
    await vi.waitFor(() => expect(control.tick).toBeGreaterThan(0), { timeout: 15000 })
    const realFrame = control.frame.bind(control)
    const frames = vi.spyOn(control, 'frame')
    const held = new Promise<void>(resolve => { releaseFrame = resolve }); let entered = false
    frames.mockImplementation(async simulate => {
      if (!simulate && !entered) { entered = true; await held }
      await realFrame(simulate)
    })
    host.querySelector<HTMLButtonElement>('[data-action="style"]')!.click()
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 15000 })
    const tick = control.tick
    window.location.hash = '#/validation-workflow'
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Validation workflow'))
    releaseFrame()
    if (canPark) {
      // Allow an already-submitted frame to settle, then confirm the parked view stays idle.
      await new Promise<void>(resolve => { setTimeout(resolve, 200) })
      const count = frames.mock.calls.length
      await new Promise<void>(resolve => { setTimeout(resolve, 200) })
      expect(frames).toHaveBeenCalledTimes(count)
    }
    window.location.hash = '#/numerical-research'
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Numerical research'))
    window.location.hash = '#/viewer-comparison'
    await vi.waitFor(() => {
      expect(host.querySelector('iframe[title="Unchanged production Cosmos WebGL viewer"]')).not.toBeNull()
      expect(host.querySelector('[data-study-status]')).toBeNull()
    })
    const returned = host.querySelector<HTMLIFrameElement>('iframe[title="Unchanged production Cosmos WebGL viewer"]')!
    await vi.waitFor(() => {
      expect((returned.contentWindow as Window & { cosmosProduction?: Promise<Production> }).cosmosProduction).toBeDefined()
    }, { timeout: 15000 })
    const resumed = await (returned.contentWindow as Window & { cosmosProduction: Promise<Production> }).cosmosProduction
    if (canPark) {
      expect(resumed.tick).toBeGreaterThanOrEqual(tick)
      const pausedTick = resumed.tick
      await new Promise<void>(resolve => { setTimeout(resolve, 200) })
      expect(resumed.tick).toBe(pausedTick)
      host.querySelector<HTMLButtonElement>('[data-action="run"]')!.click()
      await vi.waitFor(() => expect(resumed.tick).toBeGreaterThan(pausedTick), { timeout: 15000 })
      Object.defineProperty(Element.prototype, 'moveBefore', { value: undefined, configurable: true })
      window.location.hash = '#/validation-workflow'
      await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Validation workflow'))
      window.location.hash = '#/viewer-comparison'
      await vi.waitFor(() => expect(host.querySelector('[data-recovered-results]')?.textContent).toContain('Earlier live sessions'),
        { timeout: 30000 })
    }
    expect(host.querySelector('[data-recovered-results]')?.textContent).toContain('Graph position and playback state are not restored')
    host.querySelector<HTMLButtonElement>('[data-action="export"]')!.click()
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2))
    const restored = JSON.parse(await (capture.mock.calls[1][0] as Blob).text())
    expect(restored.recoveredSessions[0].records.some((row: { action: string }) => row.action === 'updates')).toBe(true)
    if (!canPark) expect(restored.recoveredSessions[0].interrupted).toBe(true)
  } finally {
    releaseFrame()
    if (moveBefore) Object.defineProperty(Element.prototype, 'moveBefore', moveBefore)
    else Reflect.deleteProperty(Element.prototype, 'moveBefore')
    vi.restoreAllMocks(); shell.destroy(); host.remove(); base.remove(); window.history.replaceState(null, '', original)
  }
}, 60000)
