import { checkResult, count as formatCount } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { validationContracts } from '../../runtime/validation'
import { pick, type Backend, type Snapshot } from './backend'
import { DEFAULTS, fixture, HEIGHT, WIDTH } from './data'
import { COLOR_BUDGET, compareSnapshots } from './reference'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

export async function createStylingView (host: HTMLElement): Promise<ExperimentInstance> {
  let runError: string | undefined
  host.innerHTML = `<p class="demo-note"
      data-run-part="explanation">Production Cosmos draw and host-picking GLSL beside a WGSL quad renderer.
    Move over either canvas to inspect the same pixel in both. Only the shape’s half-coverage interior is pickable; antialiased fringes are not.</p>
    <div
      data-run-part="configuration" class="scale-toolbar styling-toolbar">
      <label>Fixture <select data-fixture><option value="shapes">Eight shapes · fill and stroke</option>
        <option value="overlap">Overlap and draw order</option><option value="edge-cases">Defaults and edge cases</option>
        <option value="fractional">Fractional sizes and positions</option></select></label>
      <label>Zoom <select data-zoom><option>0.5</option><option selected>1</option><option>2</option></select></label>
      <label>Pixel ratio <select data-ratio><option selected>1</option><option>2</option></select></label>
      <label>Size on zoom <select data-scale><option value="yes">Scale with camera</option>
        <option value="no">Cosmos constant-size rule</option></select></label>
      <label>Global opacity <select data-opacity><option selected>1</option><option>0.35</option><option>0</option></select></label>
      <label>Draw order <select data-order><option value="normal">Input order</option><option value="reverse">Reversed</option></select></label>
      <div class="controls"><button data-export disabled
      data-run-action="export">Export JSON</button></div>
    </div><p role="status"
      data-run-part="status">Creating luma devices…</p>
    <p class="demo-note" data-legend></p>
    <section
      data-run-part="visualization" class="backend-panels styling-panels">${(['webgl', 'webgpu'] as const).map(name => `<article class="backend-panel">
      <div class="panel-heading"><h2>${name === 'webgl' ? 'Cosmos WebGL' : 'luma WebGPU'}</h2><span class="status" data-state="${name}">Starting…</span></div>
      <div class="styling-viewport"><canvas width="${WIDTH}" height="${HEIGHT}" data-canvas="${name}" aria-label="${name} styled points"></canvas>
        <span class="styling-cursor" data-cursor="${name}" hidden></span></div>
      <p data-pick="${name}" class="styling-pick">Move over a shape to inspect its ID</p><p class="demo-note" data-device="${name}"></p>
    </article>`).join('')}</section>
    <div class="many-body-results"
      data-run-part="results" data-results></div>
    <p class="demo-note"
      data-run-part="explanation">Both offscreen passes are read back for this diagnostic. Hover uses the captured ID image;
      this does not measure production picking latency. Rings, greyout, images and transitions remain outside this first styling comparison.
      <a href="#/point-styling/docs/method">Read the method and limitations</a>.</p>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const status = el('[role="status"]'); const exportButton = el<HTMLButtonElement>('[data-export]')
  const backends: Partial<Record<'webgl' | 'webgpu', Backend>> = {}
  let snapshots: Partial<Record<'webgl' | 'webgpu', Snapshot>> = {}
  const errors: Partial<Record<'webgl' | 'webgpu', string>> = {}
  let destroyed = false; let busy = false
  let latestComparison: boolean | undefined
  let report: object | undefined
  const render = async (): Promise<void> => {
    if (busy || destroyed) return
    busy = true; snapshots = {}; report = undefined; latestComparison = undefined; runError = undefined; exportButton.disabled = true
    host.querySelectorAll<HTMLElement>('[data-cursor]').forEach(cursor => { cursor.hidden = true })
    host.querySelectorAll<HTMLElement>('[data-pick]').forEach(label => { label.textContent = 'Move over a shape to inspect its ID' })
    host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
    status.textContent = 'Drawing and checking every framebuffer pixel…'
    const settings = {
      ...DEFAULTS,
      zoom: Number(el<HTMLSelectElement>('[data-zoom]').value),
      ratio: Number(el<HTMLSelectElement>('[data-ratio]').value),
      opacity: Number(el<HTMLSelectElement>('[data-opacity]').value),
      scaleOnZoom: el<HTMLSelectElement>('[data-scale]').value === 'yes',
      reverse: el<HTMLSelectElement>('[data-order]').value === 'reverse',
    }
    const name = el<HTMLSelectElement>('[data-fixture]').value as Parameters<typeof fixture>[0]; const points = fixture(name)
    el('[data-legend]').textContent = name === 'shapes'
      ? 'Circle · square · triangle · diamond · pentagon · hexagon · star · cross. Top row: fill. Bottom row: inset stroke.'
      : name === 'edge-cases'
        ? 'Top: defaults · zero size · transparent · None · absent · size cap. Bottom: subpixel · capped stroke · translucent.'
        : name === 'fractional'
          ? 'Circle diameters from 0.25 to 42.5 CSS px at fractional positions. This is a strict parity diagnostic.'
          : 'Three overlapping shapes; reverse the order to change the topmost ID without changing point identity.'
    try {
      for (const name of ['webgl', 'webgpu'] as const) {
        if (!backends[name]) continue
        try {
          snapshots[name] = await backends[name]!.render(points, settings)
          if (destroyed) return
          delete errors[name]
          el(`[data-device="${name}"]`).textContent = backends[name]!.info
          el(`[data-state="${name}"]`).textContent = 'Rendered'
        } catch (error) {
          runError = String(error)
          errors[name] = String(error); el(`[data-state="${name}"]`).textContent = 'Failed'
          el(`[data-device="${name}"]`).textContent = String(error)
        }
      }
      if (destroyed) return
      const comparison = snapshots.webgl && snapshots.webgpu ? compareSnapshots(snapshots.webgl, snapshots.webgpu, points, settings) : undefined
      latestComparison = comparison?.valid
      report = {
        schemaVersion: 1,
        experiment: 'point-styling',
        recordedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        validationContract: validationContracts['point-styling'],
        fixture: name,
        points,
        settings,
        colorBudget: COLOR_BUDGET,
        devices: Object.fromEntries(Object.entries(backends).map(([name, backend]) => [name, backend.info])),
        errors: { ...errors },
        comparison,
      }
      const output = el('[data-results]')
      if (comparison) {
        output.innerHTML = `<h3>Framebuffer audit</h3><table><tbody>
          <tr><th>Result</th><td>${checkResult(comparison.valid)}</td></tr>
          <tr><th>Pixels checked</th><td>${formatCount(comparison.pixels)}</td></tr>
          <tr><th>WebGL ↔ WebGPU ID differences</th><td>${comparison.idDisagreements}</td></tr>
          <tr><th>Scalar mask differences · WebGL / WebGPU</th><td>${comparison.webglReferenceFailures} / ${comparison.webgpuReferenceFailures}</td></tr>
          <tr><th>RGBA pixels beyond ${COLOR_BUDGET}/255 channel budget</th><td>${comparison.colorFailures} · max ${comparison.maxChannelError}/255</td></tr>
          <tr><th>Picked pixels with zero rendered alpha · WebGL / WebGPU</th>
            <td>${comparison.webglInvisiblePicks} / ${comparison.webgpuInvisiblePicks}</td></tr>
          </tbody></table>`
        status.textContent = comparison.valid
          ? 'Passed: exact IDs and shape masks; colors within the declared budget; no invisible picks.'
          : settings.opacity === 0
            ? 'Failed visibility control: production host picking still selects points at global opacity zero. Both paths retain this discrepancy.'
            : 'Differences found. Inspect the counts and export the frozen inputs; this configuration is not accepted.'
      } else {
        output.textContent = 'Incomplete comparison. Both backends must render before a verdict is available.'
        status.textContent = 'Incomplete: see backend errors.'
      }
      exportButton.disabled = false
    } finally {
      busy = false
      if (destroyed) Object.values(backends).forEach(backend => backend.destroy())
      else host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = false })
    }
  }
  const inspect = (event: PointerEvent): void => {
    if (busy || destroyed) return
    const canvas = event.currentTarget as HTMLCanvasElement; const box = canvas.getBoundingClientRect()
    const u = (event.clientX - box.left) / box.width; const v = (event.clientY - box.top) / box.height

    for (const name of ['webgl', 'webgpu'] as const) {
      const cursor = el(`[data-cursor="${name}"]`); cursor.hidden = false; cursor.style.left = `${u * 100}%`; cursor.style.top = `${v * 100}%`
      const snapshot = snapshots[name]; if (!snapshot) continue
      const x = Math.floor(u * snapshot.width); const y = Math.floor(v * snapshot.height); const id = pick(snapshot, x, y)
      const offset = (y * snapshot.width + x) * 4
      const alpha = snapshot.color[offset + 3]
      el(`[data-pick="${name}"]`).textContent = `Pixel (${x}, ${y}) · ${id === null ? 'background' : `point ${id}`} · rendered alpha ${alpha}/255`
    }
  }
  for (const name of ['webgl', 'webgpu'] as const) el(`[data-canvas="${name}"]`).addEventListener('pointermove', inspect)
  host.querySelectorAll<HTMLSelectElement>('select').forEach(c => c.addEventListener('change', () => {
    render().catch(error => { status.textContent = String(error) })
  }))
  exportButton.addEventListener('click', () => {
    if (!report || busy) return
    const json = JSON.stringify(report, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a')
    link.href = url; link.download = 'cosmos-point-styling.json'; link.click(); URL.revokeObjectURL(url)
  })
  mountRunLayout(host, () => summarizeRun(
    busy ? 'Running' : report ? 'Complete' : 'Preparing',
    [latestComparison],
    'Other fixtures, pointer-hover tolerance and production picking latency.',
    Object.keys(errors),
    runError,
    'full-image styling and picking comparisons'), { experiment: 'point-styling', devices: () => Object.values(backends).map(b => b.info) })
  for (const [name, create] of [['webgl', createStylingWebGL], ['webgpu', createStylingWebGPU]] as const) {
    try {
      const backend = await create(el<HTMLCanvasElement>(`[data-canvas="${name}"]`)); backends[name] = backend
      el(`[data-device="${name}"]`).textContent = backend.info
    } catch (error) {
      runError = String(error)
      errors[name] = String(error); el(`[data-state="${name}"]`).textContent = 'Unavailable'
      el(`[data-device="${name}"]`).textContent = String(error)
    }
  }
  try { await render() } catch (error) { runError = String(error); Object.values(backends).forEach(backend => backend.destroy()); throw error }
  return { destroy (): void { disposeRunLayout(host); destroyed = true; if (!busy) Object.values(backends).forEach(backend => backend.destroy()) } }
}
