import { checkResult, count as formatCount } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { validationContracts } from '../../runtime/validation'
import { pick, type Backend, type Snapshot, type RenderVariant } from './backend'
import { DEFAULTS, fixture, HEIGHT, WIDTH } from './data'
import { COLOR_BUDGET, compareSnapshotsAsync } from './reference'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { investigateFractional, renderFractionalInvestigation } from './fractional'
import { renderExplicitControl } from './explicit'
import { SOURCE_ALPHA_POLICY } from './source-alpha'
import {
  contributionPasses, inspectForeground, renderContributionAudit, renderTinyAlphaRows, runTinyAlphaSweep, TINY_OPACITIES,
  type TinyAlphaRow,
} from './tiny-alpha'

export async function createStylingView (host: HTMLElement): Promise<ExperimentInstance> {
  let runError: string | undefined
  host.innerHTML = `<p class="demo-note"
      data-run-part="explanation">Production Cosmos draw and host-picking GLSL beside a WGSL quad renderer.
    Move over either canvas to inspect the same pixel in both. Only the shape’s half-coverage interior is pickable; antialiased fringes are not.</p>
    <div
      data-run-part="configuration" class="scale-toolbar styling-toolbar">
      <label>Renderer <select data-renderer><option value="production">Production control</option>
        <option value="explicit">Explicit-coordinate candidate</option><option value="quantized">Source-alpha quantized candidate</option></select></label>
      <label>Fixture <select data-fixture><option value="shapes">Eight shapes · fill and stroke</option>
        <option value="overlap">Overlap and draw order</option><option value="edge-cases">Defaults and edge cases</option>
        <option value="fractional">Fractional sizes and positions</option><option value="tiny-alpha">Tiny-alpha grid</option>
        <option value="tiny-overlap">Tiny-alpha overlap</option><option value="alpha-stack">Faint overlap stack · 64 points</option></select></label>
      <label>Zoom <select data-zoom><option>0.5</option><option selected>1</option><option>2</option></select></label>
      <label>Pixel ratio <select data-ratio><option selected>1</option><option>2</option></select></label>
      <label>Size on zoom <select data-scale><option value="yes">Scale with camera</option>
        <option value="no">Cosmos constant-size rule</option></select></label>
      <label>Global opacity <select data-opacity><option selected>1</option><option>0.35</option><option>0</option>
        ${TINY_OPACITIES.filter(x => x > 0 && x < 0.35).map(x => `<option value="${x}">${x.toPrecision(5)}</option>`).join('')}</select></label>
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
    <section data-run-part="diagnostics"><h3>Tiny-alpha sweep</h3>
      <p>Check tiny positive opacity, subpixel ink and faint foreground picks. Uses offscreen draws; the live canvases and settings stay in place.</p>
      <div class="controls"><button data-tiny-sweep disabled>Run tiny-alpha sweep</button><button data-tiny-cancel disabled>Cancel sweep</button></div>
      <p data-tiny-progress>No sweep run. All rows, including failures, remain visible and exportable.</p><div data-tiny-results></div></section>
    <p class="demo-note"
      data-run-part="explanation">Both offscreen passes are read back for this diagnostic. Hover uses the captured ID image;
      this does not measure production picking latency. Rings, greyout, images and transitions remain outside this first styling comparison.
      <a href="#/point-styling/docs/method">Read the method and limitations</a>.</p>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const status = el('[role="status"]'); const exportButton = el<HTMLButtonElement>('[data-export]')
  const backends: Partial<Record<'webgl' | 'webgpu', Backend>> = {}
  let snapshots: Partial<Record<'webgl' | 'webgpu', Snapshot>> = {}
  const errors: Partial<Record<'webgl' | 'webgpu', string>> = {}
  let destroyed = false; let busy = false; let sweepRunning = false; let cancelSweep = false
  let latestComparison: boolean | undefined
  let latestCompatibility: boolean | undefined
  let latestContribution: boolean | undefined
  let tinyStudy: {
    startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[]; rows: TinyAlphaRow[]; error?: string;
  } | undefined
  let report: object | undefined
  const render = async (): Promise<void> => {
    if (busy || sweepRunning || destroyed) return
    busy = true; snapshots = {}; report = undefined; latestComparison = undefined; latestCompatibility = undefined; latestContribution = undefined
    runError = undefined; exportButton.disabled = true
    el<HTMLButtonElement>('[data-tiny-sweep]').disabled = true
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
    const variant = el<HTMLSelectElement>('[data-renderer]').value as RenderVariant
    const original: Partial<Record<'webgl' | 'webgpu', Snapshot>> = {}
    const diagnose = name === 'fractional'
    el('[data-legend]').textContent = name === 'shapes'
      ? 'Circle · square · triangle · diamond · pentagon · hexagon · star · cross. Top row: fill. Bottom row: inset stroke.'
      : name === 'edge-cases'
        ? 'Top: defaults · zero size · transparent · None · absent · size cap. Bottom: subpixel · capped stroke · translucent.'
        : name === 'fractional'
          ? 'Circle diameters from 0.25 to 42.5 CSS px at fractional positions. This is a strict parity diagnostic.'
          : name === 'tiny-alpha'
            ? 'Columns: 1/64, 1/8, 1/2, 2 and 42 CSS px. Rows: fill alpha 1, 1/255 and 1/65536. Tiny source ink may quantize to zero.'
            : name === 'tiny-overlap'
              ? 'Opaque blue background point and faint warm foreground point (fill alpha 1/65536). The foreground is also checked in isolation.'
              : name === 'alpha-stack'
                ? '64 overlapping white circles, each at fill alpha 0.51/255. Compare production color compatibility as well as candidate visibility.'
                : 'Three overlapping shapes; reverse the order to change the topmost ID without changing point identity.'
    try {
      for (const name of ['webgl', 'webgpu'] as const) {
        if (!backends[name]) continue
        try {
          if (variant !== 'production') original[name] = await backends[name]!.render(points, settings)
          snapshots[name] = await backends[name]!.render(points, settings, diagnose, variant)
          if (destroyed) return
          delete errors[name]
          el(`[data-device="${name}"]`).textContent = backends[name]!.info
          el(`[data-state="${name}"]`).textContent = 'Rendered'
          el(`[data-canvas="${name}"]`).closest('.backend-panel')!.querySelector('h2')!.textContent = variant !== 'production'
            ? `${variant === 'quantized' ? 'Quantized' : 'Explicit'} ${name === 'webgl' ? 'WebGL' : 'WebGPU'} quads`
            : name === 'webgl' ? 'Cosmos WebGL' : 'luma WebGPU'
        } catch (error) {
          runError = String(error)
          errors[name] = String(error); el(`[data-state="${name}"]`).textContent = 'Failed'
          el(`[data-device="${name}"]`).textContent = String(error)
        }
      }
      if (destroyed) return
      const contribution = name === 'tiny-overlap' && snapshots.webgl && snapshots.webgpu
        ? await inspectForeground({ webgl: backends.webgl!, webgpu: backends.webgpu! },
          { webgl: snapshots.webgl, webgpu: snapshots.webgpu }, points, settings, variant)
        : undefined
      if (destroyed) return
      const comparison = snapshots.webgl && snapshots.webgpu ? await compareSnapshotsAsync(snapshots.webgl, snapshots.webgpu, points, settings) : undefined
      const fractional = diagnose && snapshots.webgl && snapshots.webgpu
        ? investigateFractional(snapshots.webgl, snapshots.webgpu, points, settings)
        : undefined
      const analyticControl = snapshots.webgl?.analyticControl && snapshots.webgpu
        ? await compareSnapshotsAsync(snapshots.webgl.analyticControl, snapshots.webgpu, points, settings)
        : undefined
      const productionComparison = original.webgl && original.webgpu
        ? await compareSnapshotsAsync(original.webgl, original.webgpu, points, settings)
        : undefined
      const compatibility = original.webgl && snapshots.webgpu
        ? await compareSnapshotsAsync(original.webgl, snapshots.webgpu, points, settings)
        : undefined
      if (destroyed) return
      latestComparison = comparison?.valid
      latestCompatibility = compatibility?.valid
      latestContribution = contribution ? contributionPasses(contribution) : undefined
      report = {
        schemaVersion: 6,
        experiment: 'point-styling',
        recordedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        validationContract: validationContracts['point-styling'],
        fixture: name,
        renderer: variant,
        sourceAlphaPolicy: variant === 'quantized' ? SOURCE_ALPHA_POLICY : undefined,
        points,
        settings,
        colorBudget: COLOR_BUDGET,
        devices: Object.fromEntries(Object.entries(backends).map(([name, backend]) => [name, backend.info])),
        errors: { ...errors },
        comparison,
        fractional,
        analyticControl,
        productionComparison,
        compatibility,
        contribution,
      }
      const output = el('[data-results]')
      if (comparison) {
        output.innerHTML = `<h3>Framebuffer audit</h3>
          <p data-picking-rule>CPU rule: ${comparison.pickingRules.webgl === 'source-alpha'
    ? 'source-alpha — half-coverage geometry intersected with a nonzero source byte; color and picking share quantized alpha.'
    : comparison.pickingRules.webgl === 'visible'
      ? 'visible — global opacity zero returns background; positive opacity retains the half-coverage contour.'
      : 'legacy — global opacity does not change picking.'}</p><table><tbody>
          <tr><th>Result</th><td>${checkResult(comparison.valid)}</td></tr>
          <tr><th>Pixels checked</th><td>${formatCount(comparison.pixels)}</td></tr>
          <tr><th>WebGL ↔ WebGPU ID differences</th><td>${comparison.idDisagreements}</td></tr>
          <tr><th>Scalar mask differences · WebGL / WebGPU</th><td>${comparison.webglReferenceFailures} / ${comparison.webgpuReferenceFailures}</td></tr>
          <tr><th>RGBA pixels beyond ${COLOR_BUDGET}/255 channel budget</th><td>${comparison.colorFailures} · max ${comparison.maxChannelError}/255</td></tr>
          <tr><th>Painted pixels · WebGL / WebGPU</th><td>${comparison.webglPaintedPixels} / ${comparison.webgpuPaintedPixels}</td></tr>
          <tr><th>Picked pixels · WebGL / WebGPU</th><td>${comparison.webglPickedPixels} / ${comparison.webgpuPickedPixels}</td></tr>
          <tr><th>Picked pixels with zero rendered alpha · WebGL / WebGPU</th>
            <td>${comparison.webglInvisiblePicks} / ${comparison.webgpuInvisiblePicks}</td></tr>
          </tbody></table>`
        if (contribution) renderContributionAudit(output, contribution)
        if (original.webgl && original.webgpu) {
          renderExplicitControl(output, { webgl: original.webgl, webgpu: original.webgpu },
            { webgl: snapshots.webgl!, webgpu: snapshots.webgpu! }, points, settings,
            { production: productionComparison!, compatibility: compatibility! })
        }
        if (fractional) {
          renderFractionalInvestigation(output, fractional, snapshots.webgl!, snapshots.webgpu!, points, settings, analyticControl, variant)
        }
        status.textContent = comparison.valid
          ? variant !== 'production'
            ? `${variant === 'quantized' ? 'Quantized' : 'Explicit'} candidate passed. ` +
              `Production compatibility ${compatibility?.valid ? 'passed' : 'differs; see the control below'}.`
            : 'Passed: exact IDs and shape masks; colors within the declared budget; no invisible picks.'
          : variant === 'production' && settings.opacity === 0
            ? 'Failed visibility control: production host picking still selects points at global opacity zero. Both paths retain this discrepancy.'
            : 'Differences found. Inspect the counts and export the frozen inputs; this configuration is not accepted.'
        if (variant === 'quantized' && comparison.valid && compatibility && compatibility.colorFailures > 0) {
          status.textContent = `Quantized frame passed. Production color compatibility failed at ${formatCount(compatibility.colorFailures)} pixels: ` +
            `max ${compatibility.maxChannelError}/255, budget ${COLOR_BUDGET}/255.`
        }
        if (latestContribution === false) {
          status.textContent = 'Failed contribution check: the selected foreground paints zero alpha by itself. ' +
          'Background paint does not make it visible.'
        }
      } else {
        output.textContent = 'Incomplete comparison. Both backends must render before a verdict is available.'
        status.textContent = 'Incomplete: see backend errors.'
      }
      exportButton.disabled = false
      el<HTMLButtonElement>('[data-tiny-sweep]').disabled = !backends.webgl || !backends.webgpu
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
    if (!report || busy || sweepRunning) return
    const json = JSON.stringify({
      ...report,
      tinyAlphaSweep: tinyStudy && {
        ...tinyStudy,
        inputs: {
          defaults: DEFAULTS,
          sourceAlphaPolicy: SOURCE_ALPHA_POLICY,
          opacities: TINY_OPACITIES,
          ratios: [1, 2],
          fixtures: [{ name: 'tiny-alpha', points: fixture('tiny-alpha') }, { name: 'tiny-overlap', points: fixture('tiny-overlap') }],
        },
      },
    },
    (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a')
    link.href = url; link.download = 'cosmos-point-styling.json'; link.click(); URL.revokeObjectURL(url)
  })
  el('[data-tiny-cancel]').addEventListener('click', () => { cancelSweep = true })
  el('[data-tiny-sweep]').addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const runSweep = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false
      const study = {
        startedAt: new Date().toISOString(),
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as TinyAlphaRow[],
        finishedAt: undefined as string | undefined,
        error: undefined as string | undefined,
      }
      tinyStudy = study; exportButton.disabled = true
      el('[data-tiny-results]').replaceChildren()
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      el<HTMLButtonElement>('[data-tiny-sweep]').disabled = true; el<HTMLButtonElement>('[data-tiny-cancel]').disabled = false
      el('[data-tiny-progress]').textContent = 'Starting 32 paired rows…'
      try {
        await runTinyAlphaSweep({ webgl: backends.webgl!, webgpu: backends.webgpu! }, row => {
          study.rows.push(row)
          if (destroyed) return
          renderTinyAlphaRows(el('[data-tiny-results]'), study.rows)
          el('[data-tiny-progress]').textContent = `${study.rows.length} / 32 rows · ${row.fixture} · ratio ${row.ratio} · ` +
            `opacity ${row.opacity.toPrecision(5)}`
        }, () => cancelSweep || destroyed)
        study.status = cancelSweep || destroyed ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error); runError = study.error } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) Object.values(backends).forEach(backend => backend.destroy())
        else {
          host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = false })
          exportButton.disabled = !report; el<HTMLButtonElement>('[data-tiny-sweep]').disabled = false
          el<HTMLButtonElement>('[data-tiny-cancel]').disabled = true
          el('[data-tiny-progress]').textContent = `${study.status} · ${study.rows.length} / 32 rows · ` +
            `${study.rows.filter(row => !row.candidateAccepted).length} explicit / ` +
            `${study.rows.filter(row => !row.quantizedAccepted).length} quantized rows rejected. Export JSON retains every count and first failure.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error) })
  })
  mountRunLayout(host, () => summarizeRun(
    busy || sweepRunning ? 'Running' : report ? 'Complete' : 'Preparing',
    [latestComparison, ...(latestContribution === undefined ? [] : [latestContribution]),
      ...(latestCompatibility === undefined ? [] : [latestCompatibility])],
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
  return {
    destroy (): void {
      disposeRunLayout(host); destroyed = true; cancelSweep = true
      if (!busy && !sweepRunning) Object.values(backends).forEach(backend => backend.destroy())
    },
  }
}
