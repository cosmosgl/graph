import { comparePixels } from '../../runtime/compare-pixels'
import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { hoverCursor, runStationaryHover, type HoverSample } from './stationary-hover'
import './stationary-hover-view.css'

export function createStationaryHoverView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar">
    <label>Pixel ratio <select data-ratio><option value="1">1×</option><option value="2">2×</option></select></label>
    <label>Checkpoint <select data-checkpoint disabled></select></label></div>
    <button data-run-action="primary" type="button" data-replay>Replay on this GPU</button>
    <div data-run-part="visualization">
      <p>White ticks mark where the pointer was parked in each canvas.</p>
      <div class="stationary-hover-panels"></div></div>
    <p data-run-part="status" data-hover-status></p>`
  mountRunLayout(host)
  const ratio = host.querySelector<HTMLSelectElement>('[data-ratio]')!
  const checkpoint = host.querySelector<HTMLSelectElement>('[data-checkpoint]')!
  const retry = host.querySelector<HTMLButtonElement>('[data-replay]')!
  const status = host.querySelector<HTMLElement>('[data-hover-status]')!
  const panels = host.querySelector<HTMLElement>('.stationary-hover-panels')!
  const lanes = (['webgl', 'webgpu'] as const).map(engine => {
    const panel = document.createElement('section')
    const name = engine === 'webgl' ? 'WebGL' : 'WebGPU'
    panel.innerHTML = `<h3>${name}</h3>
      <div class="stationary-hover-surface" data-loading><canvas width="192" height="128" aria-label="${name} graph"></canvas></div>
      <p data-ring></p><p data-events></p><p data-movement></p>`
    panels.append(panel)
    return {
      engine,
      surface: panel.querySelector<HTMLElement>('.stationary-hover-surface')!,
      canvas: panel.querySelector('canvas')!,
      ring: panel.querySelector<HTMLElement>('[data-ring]')!,
      events: panel.querySelector<HTMLElement>('[data-events]')!,
      movement: panel.querySelector<HTMLElement>('[data-movement]')!,
      samples: [] as HoverSample[],
    }
  })
  let destroyed = false

  function showCheckpoint (): void {
    const samples = lanes.map(lane => lane.samples[checkpoint.selectedIndex])
    for (const [index, lane] of lanes.entries()) {
      const sample = samples[index]
      if (!sample) continue
      const { pixels, events, ringPixels, ringPixelsAtCursor } = sample
      lane.canvas.width = pixels.width
      lane.canvas.height = pixels.height
      const width = pixels.width / Number(ratio.value)
      const height = pixels.height / Number(ratio.value)
      lane.canvas.style.width = `${width}px`
      lane.surface.style.setProperty('--pointer-x', `${100 * hoverCursor[0] / width}%`)
      lane.surface.style.setProperty('--pointer-y', `${100 * hoverCursor[1] / height}%`)
      lane.canvas.getContext('2d')!.putImageData(pixels, 0, 0)
      delete lane.surface.dataset.loading
      lane.ring.textContent = ringPixels ? `Ring at pointer · ${ringPixelsAtCursor} of ${ringPixels} pixels` : 'Hover ring absent'
      lane.events.textContent = events.length ? `Point callbacks · ${events.join(' → ')}` : 'No point hover callbacks yet'
      lane.movement.textContent = `Mouse move callbacks · ${sample.mouseMoves}`
    }
    const [gl, gpu] = samples
    if (!gl || !gpu) { status.textContent = 'Both packages must return a frame to compare hover.'; return }
    const sameEvents = gl.mouseMoves === gpu.mouseMoves && gl.events.length === gpu.events.length &&
      gl.events.every((event, i) => event === gpu.events[i])
    const { differingPixels, totalPixels } = comparePixels(gl.pixels, gpu.pixels)
    status.textContent = `Callbacks ${sameEvents ? 'match' : 'differ'}. ${differingPixels.toLocaleString()} of ${totalPixels.toLocaleString()} pixels differ.`
  }

  async function replay (): Promise<void> {
    const selected = checkpoint.value
    const pixelRatio = ratio.value === '2' ? 2 : 1
    retry.disabled = checkpoint.disabled = ratio.disabled = true
    status.textContent = 'Replaying point and camera motion…'
    for (const lane of lanes) {
      lane.samples = []; lane.surface.dataset.loading = ''
      lane.ring.textContent = lane.events.textContent = lane.movement.textContent = ''
    }
    for (const lane of lanes) {
      if (destroyed) return
      try { lane.samples = (await runStationaryHover(lane.engine, pixelRatio)).samples } catch (error) {
        if (!destroyed) lane.events.textContent = String(error)
      }
    }
    if (destroyed) return
    const samples = lanes.find(lane => lane.samples.length)?.samples ?? []
    checkpoint.replaceChildren(...samples.map(sample => new Option(sample.phase, sample.phase)))
    if (samples.some(sample => sample.phase === selected)) checkpoint.value = selected
    retry.disabled = ratio.disabled = false
    checkpoint.disabled = !samples.length
    showCheckpoint()
  }
  checkpoint.onchange = showCheckpoint
  ratio.onchange = retry.onclick = replay
  replay()
  return { destroy (): void { destroyed = true; disposeRunLayout(host) } }
}
