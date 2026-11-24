import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { lineCases, type LineCase } from './fixture'
import { inspectMotionPaint, motionCase, phaseSteps } from './motion'
import { compareLines } from './compare'
import { mountLinePreview, type LineSession, type LineSnapshot } from './frame'
import './view.css'

export function createLinesView (host: HTMLElement, caseId?: string): ExperimentInstance {
  const scene = caseId === motionCase ? motionCase : caseId && Object.hasOwn(lineCases, caseId) ? caseId as LineCase : 'straight'
  const motionControls = scene === motionCase
    ? `<label>Stroke style
    <select data-lines-style><option value="dashed">Dashed</option><option value="solid">Solid control</option></select></label>
    <label>Endpoint phase <input type="range" min="-${phaseSteps}" max="${phaseSteps}" value="0" data-lines-phase>
    <output data-lines-offset>0</output> device pixels</label>
    <button type="button" data-lines-worst>Show worst M3 phase</button>`
    : ''
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar"><label>Pixel ratio
    <select data-lines-ratio><option value="1">1×</option><option value="2">2×</option></select></label>
    ${motionControls}</div>
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
  const highlight = host.querySelector<HTMLInputElement>('.package-lines-highlight input')!
  const phase = host.querySelector<HTMLInputElement>('[data-lines-phase]')
  const offset = host.querySelector<HTMLOutputElement>('[data-lines-offset]')
  const style = host.querySelector<HTMLSelectElement>('[data-lines-style]')
  move.hidden = scene === motionCase
  const rows = host.querySelector('tbody')!
  const overlay = document.createElement('canvas')
  overlay.hidden = true
  overlay.setAttribute('aria-hidden', 'true')
  lanes[1]!.surface.append(overlay)
  let moved = scene === 'moving'
  let destroyed = false
  let measuring = false
  let pending: Promise<void> = Promise.resolve()
  function clear (): void {
    for (const lane of lanes) { lane.session?.destroy(); lane.session = undefined; lane.snapshot = undefined }
  }
  function run (reload: boolean): void {
    if (measuring || destroyed) return
    measuring = true
    const index = Number(phase?.value ?? 0)
    const stroke = style?.value === 'solid' ? 'solid' : 'dashed'
    if (style) style.disabled = true
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
        lane.session ??= await mountLinePreview(lane.surface, lane.engine, ratio, scene, stroke)
        if (destroyed) return
        lane.snapshot = await lane.session.measure(scene === motionCase ? index : moved)
        lane.status.textContent = ''
      } catch (error) {
        lane.session?.destroy(); lane.session = undefined
        if (!destroyed) lane.status.textContent = String(error)
      }
    })).then(() => {
      if (destroyed) return
      scale.disabled = retry.disabled = false
      if (style) style.disabled = false
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
        : `${report.differingPixels.toLocaleString()} of ${report.totalPixels.toLocaleString()} pixels differ. ` +
          `Largest channel difference ${report.maxChannelDelta}/255.`
      const hits = gl.picks.length - report.pickFailures
      result.textContent = `${exact} ${hits}/${gl.picks.length} click targets matched the expected ID in both packages. ` +
        `${report.outsideEdgeBand} pixels outside the one-pixel edge allowance. ${report.interiorColorFailures} interior color failures.`
      if (scene === motionCase) {
        const checks = [gl, gpu].map(s => inspectMotionPaint(s.pixels, index, ratio, stroke))
        const missing = checks[0]!.missing + checks[1]!.missing
        const painted = checks[0]!.paintedGaps + checks[1]!.paintedGaps
        result.textContent += ` Phase ${index}/${phaseSteps} device pixels. ${missing} missing stroke centers. ${painted} filled gap centers.`
      }
      gl.picks.forEach((pick, i) => {
        const row = rows.insertRow()
        const header = document.createElement('th')
        header.scope = 'row'
        header.textContent = `${pick.label} (${pick.xy.join(', ')})`
        row.append(header)
        for (const value of [pick.expected, pick.actual, gpu.picks[i]!.actual]) row.insertCell().textContent = value
      })
    }).finally(() => {
      measuring = false
      if (!destroyed && phase && Number(phase.value) !== index) run(false)
    })
  }
  if (phase && offset) {
    const showPhase = (): void => {
      offset.value = String(Number(phase.value) / phaseSteps)
      phase.setAttribute('aria-valuetext', `${offset.value} device pixels`)
      run(false)
    }
    phase.setAttribute('aria-valuetext', '0 device pixels')
    phase.oninput = showPhase
    host.querySelector<HTMLButtonElement>('[data-lines-worst]')!.onclick = (): void => {
      // Both styles reached their recorded native maximum at these phases.
      phase.value = scale.value === '1' ? '-32' : '-16'
      showPhase()
    }
  }
  if (style) style.onchange = (): void => run(true)
  move.onclick = (): void => { moved = !moved; run(false) }
  retry.onclick = (): void => run(lanes.every(lane => lane.session))
  scale.onchange = (): void => run(true)
  highlight.onchange = (): void => { overlay.hidden = !highlight.checked }
  run(true)
  return { destroy (): void { destroyed = true; pending.then(clear, clear); disposeRunLayout(host) } }
}
