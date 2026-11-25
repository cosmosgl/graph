import { comparePixels } from '../../runtime/compare-pixels'
import type { ExperimentInstance } from '../../runtime/experiment'
import type { Engine } from './frame'

type PickFrame<K extends string> = {
  key: string;
  title: string;
  pixels: ImageData;
  picks: Record<K, string>;
  detail?: string;
}

export function createPairedPickView<K extends string> (host: HTMLElement, settings: {
  probes: Record<K, string>;
  initial?: string;
  run(engine: Engine, ratio: 1 | 2): Promise<PickFrame<K>[]>;
}): ExperimentInstance {
  host.innerHTML = `<div class="controls">
    <label>Pixel ratio <select data-ratio><option value="1">1×</option><option value="2">2×</option></select></label>
    <label>Frame <select data-frame disabled></select></label>
    <button data-replay type="button">Replay on this GPU</button></div>
    <div class="viewer-comparison-panels"></div>
    <p role="status"></p>
    <table><caption>Click results at this frame</caption>
    <thead><tr><th scope="col">Location</th><th scope="col">WebGL</th><th scope="col">WebGPU</th></tr></thead><tbody></tbody></table>`
  const ratio = host.querySelector<HTMLSelectElement>('[data-ratio]')!
  const frame = host.querySelector<HTMLSelectElement>('[data-frame]')!
  const replayButton = host.querySelector<HTMLButtonElement>('[data-replay]')!
  const status = host.querySelector<HTMLElement>('[role="status"]')!
  const rows = host.querySelector('tbody')!
  const panels = host.querySelector('.viewer-comparison-panels')!
  const lanes = (['webgl', 'webgpu'] as const).map(engine => {
    const panel = document.createElement('section')
    const title = document.createElement('h3')
    title.textContent = engine === 'webgl' ? 'WebGL' : 'WebGPU'
    const canvas = document.createElement('canvas')
    canvas.style.maxWidth = '100%'
    canvas.setAttribute('aria-label', `${title.textContent} frame`)
    const message = document.createElement('p')
    panel.append(title, canvas, message)
    panels.append(panel)
    return { engine, canvas, message, samples: [] as PickFrame<K>[] }
  })
  let disposed = false

  function showFrame (): void {
    const samples = lanes.map(lane => lane.samples[frame.selectedIndex])
    for (const [i, sample] of samples.entries()) {
      if (!sample) continue
      const canvas = lanes[i]!.canvas
      canvas.width = sample.pixels.width
      canvas.height = sample.pixels.height
      canvas.style.width = `${canvas.width / Number(ratio.value)}px`
      canvas.getContext('2d')!.putImageData(sample.pixels, 0, 0)
      canvas.hidden = false
      lanes[i]!.message.textContent = sample.detail ?? ''
    }
    rows.replaceChildren()
    for (const key of Object.keys(settings.probes) as K[]) {
      const row = rows.insertRow()
      const heading = document.createElement('th')
      heading.scope = 'row'; heading.textContent = settings.probes[key]; row.append(heading)
      for (const sample of samples) row.insertCell().textContent = sample?.picks[key] ?? '—'
    }
    if (samples[0] && samples[1]) {
      const diff = comparePixels(samples[0].pixels, samples[1].pixels)
      status.textContent = `${diff.differingPixels.toLocaleString()} of ${diff.totalPixels.toLocaleString()} pixels differ.`
    } else status.textContent = 'Both packages must finish for a pixel comparison.'
  }

  async function run (): Promise<void> {
    const pixelRatio = ratio.value === '2' ? 2 : 1
    const selected = frame.value
    ratio.disabled = frame.disabled = replayButton.disabled = true
    rows.replaceChildren()
    status.textContent = 'Capturing frames and click results from both packages…'
    for (const lane of lanes) {
      lane.canvas.hidden = true
      lane.message.textContent = ''
      lane.samples = []
    }
    for (const lane of lanes) {
      if (disposed) return
      try { lane.samples = await settings.run(lane.engine, pixelRatio) } catch (error) {
        if (!disposed) lane.message.textContent = String(error)
      }
    }
    if (disposed) return
    const samples = lanes.find(lane => lane.samples.length)?.samples ?? []
    frame.replaceChildren(...samples.map(sample => new Option(sample.title, sample.key)))
    frame.value = selected || settings.initial || samples[0]?.key || ''
    if (frame.selectedIndex < 0 && frame.options.length) frame.selectedIndex = 0
    ratio.disabled = replayButton.disabled = false
    frame.disabled = !samples.length
    showFrame()
  }
  frame.onchange = showFrame
  ratio.onchange = replayButton.onclick = run
  run()
  return { destroy (): void { disposed = true } }
}
