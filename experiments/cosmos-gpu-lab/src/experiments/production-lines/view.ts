import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { lineCases, type LineCase } from './fixture'
import { compareLines } from './compare'
import { mountLinePreview, type LineSession, type LineSnapshot } from './frame'
import './view.css'

export function createLinesView (host: HTMLElement, caseId?: string): ExperimentInstance {
  const scene: LineCase = caseId && Object.hasOwn(lineCases, caseId) ? caseId as LineCase : 'straight'
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar"><label>Pixel ratio
    <select data-lines-ratio><option value="1">1×</option><option value="2">2×</option></select></label></div>
    <button data-run-action="primary" type="button" data-lines-move>Move endpoint</button>
    <button data-run-action="primary" type="button" data-lines-reload>Reload</button>
    <div data-run-part="visualization"><div class="package-lines-panels"></div>
      <label class="package-lines-highlight"><input type="checkbox" disabled> Highlight differing pixels on WebGPU</label></div>
    <div data-run-part="status" class="package-lines-result"><p data-lines-result role="status"></p>
      <table><caption>Click results at CSS pixel coordinates</caption><thead><tr>
        <th scope="col">Location</th><th scope="col">Expected</th><th scope="col">WebGL</th><th scope="col">WebGPU</th>
      </tr></thead><tbody></tbody></table></div>`
  mountRunLayout(host)
  const panels = host.querySelector<HTMLElement>('.package-lines-panels')!
  const lanes = (['webgl', 'webgpu'] as const).map(engine => {
    const panel = document.createElement('section')
    const title = document.createElement('h3')
    title.textContent = engine === 'webgl' ? 'WebGL Graph' : 'WebGPU Graph'
    const surface = document.createElement('div')
    surface.className = 'package-lines-surface'
    const status = document.createElement('p')
    panel.append(title, surface, status); panels.append(panel)
    return { engine, surface, status, session: undefined as LineSession | undefined, snapshot: undefined as LineSnapshot | undefined }
  })
  const move = host.querySelector<HTMLButtonElement>('[data-lines-move]')!
  const retry = host.querySelector<HTMLButtonElement>('[data-lines-reload]')!
  const scale = host.querySelector<HTMLSelectElement>('[data-lines-ratio]')!
  const result = host.querySelector<HTMLElement>('[data-lines-result]')!
  const highlight = host.querySelector<HTMLInputElement>('input')!
  const rows = host.querySelector('tbody')!
  const overlay = document.createElement('canvas')
  overlay.hidden = true
  overlay.setAttribute('aria-hidden', 'true')
  lanes[1]!.surface.append(overlay)
  let moved = scene === 'moving'
  let destroyed = false
  let pending: Promise<void> = Promise.resolve()
  function clear (): void {
    for (const lane of lanes) { lane.session?.destroy(); lane.session = undefined; lane.snapshot = undefined }
  }
  function run (reload: boolean): void {
    scale.disabled = move.disabled = retry.disabled = highlight.disabled = true
    overlay.hidden = true
    rows.replaceChildren()
    result.textContent = 'Drawing both packages and replaying clicks…'
    move.textContent = moved ? 'Restore endpoint' : 'Move endpoint'
    const ratio = scale.value === '2' ? 2 : 1
    pending = Promise.all(lanes.map(async lane => {
      if (reload) { lane.session?.destroy(); lane.session = undefined }
      lane.snapshot = undefined
      try {
        lane.session ??= await mountLinePreview(lane.surface, lane.engine, ratio, scene)
        if (destroyed) return
        lane.snapshot = await lane.session.measure(moved)
        lane.status.textContent = ''
      } catch (error) {
        lane.session?.destroy(); lane.session = undefined
        if (!destroyed) lane.status.textContent = String(error)
      }
    })).then(() => {
      if (destroyed) return
      scale.disabled = retry.disabled = false
      move.disabled = !lanes.some(lane => lane.session)
      const [gl, gpu] = lanes.map(lane => lane.snapshot)
      if (!gl || !gpu) { result.textContent = 'Both Graph snapshots are required for comparison.'; return }
      overlay.width = gl.pixels.width; overlay.height = gl.pixels.height
      const ctx = overlay.getContext('2d')!
      const mask = ctx.createImageData(overlay.width, overlay.height)
      const report = compareLines(gl, gpu, mask)
      ctx.putImageData(mask, 0, 0)
      highlight.disabled = false; overlay.hidden = !highlight.checked
      const exact = report.differingPixels === 0
        ? `Exact match across ${report.totalPixels.toLocaleString()} pixels.`
        : `${report.differingPixels.toLocaleString()} of ${report.totalPixels.toLocaleString()} pixels differ. Largest channel difference ${report.maxChannelDelta}/255.`
      result.textContent = `${exact} ${gl.picks.length - report.pickFailures}/${gl.picks.length} click targets matched the expected ID in both packages. ${report.outsideEdgeBand} pixels outside the one-pixel edge allowance. ${report.interiorColorFailures} interior color failures.`
      gl.picks.forEach((pick, i) => {
        const row = rows.insertRow()
        const header = document.createElement('th')
        header.scope = 'row'
        header.textContent = `${pick.label} (${pick.xy.join(', ')})`
        row.append(header)
        for (const value of [pick.expected, pick.actual, gpu.picks[i]!.actual]) row.insertCell().textContent = value
      })
    })
  }
  move.onclick = (): void => { moved = !moved; run(false) }
  retry.onclick = (): void => run(lanes.every(lane => lane.session))
  scale.onchange = (): void => run(true)
  highlight.onchange = (): void => { overlay.hidden = !highlight.checked }
  run(true)
  return { destroy (): void { destroyed = true; pending.then(clear, clear); disposeRunLayout(host) } }
}
