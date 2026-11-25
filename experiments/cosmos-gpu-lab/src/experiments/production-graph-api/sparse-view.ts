import { comparePixels } from '../../runtime/compare-pixels'
import type { ExperimentInstance } from '../../runtime/experiment'
import { runSparseTransition } from './sparse-transition'

type Replay = Awaited<ReturnType<typeof runSparseTransition>>

const phases = new Map([
  ['initial', 'Before removal'],
  ['remove', 'Removal'],
  ['restore', 'Restoration'],
  ['snap-remove', 'Immediate removal'],
  ['snap-restore', 'Immediate restoration'],
])

export function createSparseView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = `<div class="controls">
    <label>Pixel ratio <select data-ratio><option value="1">1×</option><option value="2">2×</option></select></label>
    <label>Frame <select data-frame disabled></select></label></div>
    <div class="viewer-comparison-panels"></div>
    <p role="status"></p>
    <table><caption>Click results at this frame</caption>
    <thead><tr><th scope="col">Location</th><th scope="col">WebGL</th><th scope="col">WebGPU</th></tr></thead><tbody></tbody></table>`
  const ratio = host.querySelector<HTMLSelectElement>('[data-ratio]')!
  const frame = host.querySelector<HTMLSelectElement>('[data-frame]')!
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
    return { engine, canvas, message, replay: undefined as Replay | undefined }
  })
  let disposed = false

  function showFrame (): void {
    const samples = lanes.map(lane => lane.replay?.samples[frame.selectedIndex])
    for (const [i, sample] of samples.entries()) {
      if (!sample) continue
      const canvas = lanes[i]!.canvas
      canvas.width = sample.pixels.width
      canvas.height = sample.pixels.height
      canvas.style.width = `${canvas.width / Number(ratio.value)}px`
      canvas.getContext('2d')!.putImageData(sample.pixels, 0, 0)
      canvas.hidden = false
    }
    rows.replaceChildren()
    for (const [key, label] of [['point', 'Edited point'], ['link', 'Incident link'], ['anchor', 'Other endpoint'], ['control', 'Isolated point']] as const) {
      const row = rows.insertRow()
      const heading = document.createElement('th')
      heading.scope = 'row'; heading.textContent = label; row.append(heading)
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
    ratio.disabled = frame.disabled = true
    rows.replaceChildren()
    status.textContent = 'Replaying point removal and restoration…'
    for (const lane of lanes) {
      lane.canvas.hidden = true
      lane.message.textContent = ''
      lane.replay = undefined
    }
    for (const lane of lanes) {
      if (disposed) return
      try { lane.replay = await runSparseTransition(lane.engine, pixelRatio) } catch (error) {
        if (!disposed) lane.message.textContent = String(error)
      }
    }
    if (disposed) return
    const replay = lanes.find(lane => lane.replay)?.replay
    frame.replaceChildren()
    for (const sample of replay?.samples ?? []) {
      const animated = sample.phase === 'remove' || sample.phase === 'restore'
      const value = `${sample.phase}-${sample.time}`
      const label = phases.get(sample.phase)!
      frame.add(new Option(animated ? `${label} · ${sample.time} ms` : label, value))
    }
    frame.value = selected || 'remove-500'
    if (frame.selectedIndex < 0 && frame.options.length) frame.selectedIndex = 0
    ratio.disabled = false
    frame.disabled = !replay
    showFrame()
  }
  frame.onchange = showFrame
  ratio.onchange = run
  run()
  return { destroy (): void { disposed = true } }
}
