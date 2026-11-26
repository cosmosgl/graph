import { expect, it, vi } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'

it.each(['webgl', 'webgpu'] as const)('updates and disposes each built %s Graph’s own frame monitor', async engine => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const doc = frame.contentDocument!
  const host = (): HTMLDivElement => {
    const div = doc.createElement('div')
    div.style.cssText = 'position:relative;width:100px;height:80px'
    doc.body.append(div)
    return div
  }
  const firstHost = host()
  const secondHost = host()
  const widget = (div: HTMLElement): HTMLElement | null => div.querySelector(':scope > #gl-bench')
  const rate = (div: HTMLElement): number => parseInt(div.querySelector('.gl-fps')?.textContent ?? '', 10)
  const GRAPH = await loadGraphPackage(engine, doc)
  const config = { enableSimulation: false, fitViewOnInit: false }
  const first = new GRAPH(firstHost, { ...config, showFPSMonitor: true })
  const second = new GRAPH(secondHost, { ...config, enableRenderLoop: false })
  const headless = new GRAPH(null, { ...config, showFPSMonitor: true })
  try {
    await Promise.all([first.ready, second.ready, headless.ready])
    const device = first.simulation.device!.info
    expect(device.type).toBe(engine)
    if (import.meta.env.LAB_NATIVE_GPU) {
      if (engine === 'webgpu') expect(device.fallback).toBe(false)
      else expect(device.gpuType).not.toBe('cpu')
    }
    for (const graph of [first, second]) {
      graph.setPointPositions(Float32Array.of(2048, 2048))
      graph.render(0, 0)
    }
    expect(widget(firstHost)).not.toBeNull()
    expect(widget(secondHost)).toBeNull()
    headless.setConfigPartial({ showFPSMonitor: false })
    headless.setConfigPartial({ showFPSMonitor: true })
    expect(doc.querySelectorAll('#gl-bench')).toHaveLength(1)

    // A static graph keeps drawing while its monitor is visible.
    await vi.waitFor(() => expect(rate(firstHost)).toBeGreaterThan(0), { timeout: 6000 })
    expect(firstHost.querySelector('.gl-cpu')?.getAttribute('style')).toContain('stroke-dasharray')
    const automaticFps = rate(firstHost)
    second.setConfigPartial({ showFPSMonitor: true })
    second.renderOneFrame()
    const survivor = widget(secondHost)!
    expect(doc.querySelectorAll('#gl-bench')).toHaveLength(2)
    if (engine === 'webgpu') {
      expect(survivor.title).toContain('GPU time is unavailable')
      survivor.click()
      expect(doc.defaultView!.getComputedStyle(survivor.querySelector('.gl-gpu-svg')!).display).toBe('none')
    }

    first.setConfigPartial({ showFPSMonitor: false })
    expect(widget(firstHost)).toBeNull()
    expect(firstHost.querySelector('#gl-bench-style')).toBeNull()
    first.setConfigPartial({ showFPSMonitor: true })
    expect(widget(firstHost)).not.toBeNull()
    first.destroy()
    expect(widget(secondHost)).toBe(survivor)
    expect(doc.querySelectorAll('#gl-bench-style')).toHaveLength(1)

    // A host that disables the loop controls which frames get measured.
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect(rate(secondHost)).toBe(0)
    second.renderOneFrame()
    expect(rate(secondHost)).toBeGreaterThan(0)
    const manualFps = rate(secondHost)
    second.setConfig(config)
    expect(doc.querySelectorAll('#gl-bench, #gl-bench-style')).toHaveLength(0)
    await writeArtifact(`fps-monitor-${engine}`, { device, automaticFps, manualFps })
  } finally {
    first.destroy()
    second.destroy()
    headless.destroy()
    frame.remove()
  }
})
