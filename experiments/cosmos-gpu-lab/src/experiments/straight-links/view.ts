import type { ExperimentInstance } from '../../runtime/experiment'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import { compactRunControls } from '../../runtime/compact-controls'
import { validationContracts } from '../../runtime/validation'
import { pick } from '../../gpu/rgba-readback'
import { SOURCE_BYTE_PICKING_POLICY } from '../../gpu/source-alpha'
import { PATTERNS, type Pattern } from './patterns'
import { GRADIENT_PRESETS, GRADIENT_LABELS, gradientScene, type GradientPreset } from './gradient-fixtures'
import { DEFAULTS, FIXTURES, fixture, WIDTH, HEIGHT, type Fixture, type Settings, type Variant } from './data'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { compare, compareColors, type Comparison } from './reference'
import { contributions, ROW_COUNT, runSweep, renderRows, type Pair, type Row } from './study'
import type { Backend } from './backend'
import { replayHardCoverage, renderHardCoverage, type HardRow } from './hard-coverage'
import { replayRaster, renderRaster, RASTER_ROWS, type RasterRow } from './raster-audit'
export async function createLinksView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar styling-toolbar">
    <label>Stroke <select data-pattern>${PATTERNS.map(p => `<option value="${p}">${p}</option>`).join('')}</select>
      <span class="control-guidance">Production IDs include gaps; the visible-pixel candidate checks patterned paint.</span></label>
    <label>Dash length <select data-dash-length><option>3.5</option><option selected>5</option><option>12</option></select></label>
    <label>Pattern gap <select data-dash-gap><option>0</option><option>3.25</option><option selected>5</option></select></label>
    <label>Color source <select data-gradient>${GRADIENT_PRESETS.map((p, i) =>
    `<option value="${p}">${GRADIENT_LABELS[i]}</option>`).join('')}</select>
      <span class="control-guidance">RGB follows the ribbon parameter. Link alpha controls opacity; endpoint alpha is ignored.</span></label>
    <label>Picking rule <select data-variant><option value="visible">Visible-footprint candidate</option>
      <option value="production">Production · padded host IDs</option></select></label>
    <label>Fixture <select data-fixture>${FIXTURES.map(name => `<option value="${name}">${name}</option>`).join('')}</select></label>
    <label>Zoom <select data-zoom><option>0.5</option><option selected>1</option><option>2</option></select></label>
    <label>Pixel ratio <select data-ratio><option selected>1</option><option>2</option></select></label>
    <label>Link opacity <select data-opacity><option selected>1</option><option>0.35</option><option>0</option></select></label>
    <label>Rendering <select data-blend><option value="blend">Blended · antialiased</option><option value="hard">Opaque · hard edges</option></select></label>
    <label>Width on zoom <select data-scale><option value="yes">Scale with camera</option><option value="no">Constant screen width</option></select></label>
    <label>Draw order <select data-order><option value="normal">Input order</option><option value="reverse">Reversed</option></select></label>
    <div class="controls"><button data-compare data-run-action="primary">Compare</button>
      <button data-export data-run-action="export" disabled>Export JSON</button></div>
    </div><p role="status" data-run-part="status">Creating luma devices…</p>
    <section data-run-part="visualization" class="backend-panels styling-panels">
    ${(['webgl', 'webgpu'] as const).map(lane => `<article class="backend-panel">
      <div class="panel-heading"><h2>${lane === 'webgl' ? 'Cosmos WebGL' : 'luma WebGPU'}</h2><span data-state="${lane}">Starting…</span></div>
      <div class="styling-viewport"><canvas data-canvas="${lane}" width="${WIDTH}" height="${HEIGHT}" aria-label="${lane} straight links"></canvas>
      <span class="styling-cursor" data-cursor="${lane}" hidden></span></div><p class="styling-pick" data-pick="${lane}">Move over a link to inspect its ID</p>
      <p class="demo-note" data-device="${lane}"></p></article>`).join('')}</section>
    <section data-run-part="results" data-results class="readiness-table"></section>
    <p data-run-part="explanation">Frozen straight ribbons use production GLSL and geometry beside a WGSL port, with resident endpoint reads.
      The production ID pass adds five CSS pixels of width; the candidate removes that allowance and gates blended picks by their source alpha byte.
      Visible color uses the original draw. AA fringes outside the half-coverage contour can paint without being pickable.
      Opaque mode ignores positive opacity magnitude, like production. This is host picking, not the pointer window or its latency.</p>
    <section data-run-part="diagnostics"><h3>Repeatable straight-link sweep</h3><p>${ROW_COUNT} cases: four scenes × five profiles × blended/hard modes.
      The sweep uses the selected color source and stroke; boundary replays keep their recorded solid controls.
      Production and visible-footprint results remain separate. Fractional and aligned cap failures stay visible.</p>
      <div class="controls"><button data-sweep disabled>Run straight-link sweep</button><button data-cancel disabled>Cancel sweep</button></div>
      <p data-progress>No sweep run.</p><div data-sweep-results class="readiness-table"></div>
      <h3>Hard-edge coverage replay</h3><p>Isolate three hard-edge sources. Compare native, linear-interpolated and pixel-distance WebGPU coverage
        with unchanged Cosmos WebGL and scalar masks. All alternatives retain the original-color check; improved coverage alone does not pass.</p>
      <div class="controls"><button data-hard-replay disabled>Replay hard-edge coverage</button><button data-hard-cancel disabled>Cancel replay</button></div>
      <p data-hard-progress>No hard-edge replay run.</p><div data-hard-output class="readiness-table"></div>
      <h3>Caps and fractional raster replay</h3><p>${RASTER_ROWS} isolated comparisons: eight sources, four small device-pixel shifts, the original input
        and endpoint reversal. Capture vertices and replay identical geometry on both APIs. Original controls and all pixel gates remain unchanged.</p>
      <div class="controls"><button data-raster-replay disabled>Replay caps and fractional raster</button>
        <button data-raster-cancel disabled>Cancel raster replay</button></div>
      <p data-raster-progress>No cap/raster replay run.</p><div data-raster-output class="readiness-table"></div></section>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const backends: Partial<Record<'webgl' | 'webgpu', Backend>> = {}; let snapshots: Partial<Pair> = {}
  const status = el('[role="status"]'); let report: object | undefined; let accepted: boolean | undefined
  let busy = false; let sweeping = false; let cancelled = false; let destroyed = false; let disposed = false; let runError: string | undefined
  let study: { patternSettings: Pick<Settings, 'pattern' | 'dashLength' | 'dashGap'>;
    gradient: GradientPreset; startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[];
    rows: Row[]; error?: string; } | undefined
  let hardReplay: { startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[]; rows: HardRow[]; error?: string } | undefined
  let rasterReplay: {
    startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[]; rows: RasterRow[]; error?: string;
  } | undefined
  const dispose = (): void => { if (!disposed) { disposed = true; Object.values(backends).forEach(b => b.destroy()) } }
  const controls = (disabled: boolean): void => {
    host.querySelectorAll<HTMLSelectElement>('select').forEach(s => { s.disabled = disabled })
    el<HTMLButtonElement>('[data-compare]').disabled = disabled
    el<HTMLButtonElement>('[data-sweep]').disabled = disabled || !backends.webgl || !backends.webgpu
    el<HTMLButtonElement>('[data-hard-replay]').disabled = disabled || !backends.webgl || !backends.webgpu
    el<HTMLButtonElement>('[data-raster-replay]').disabled = disabled || !backends.webgl || !backends.webgpu
    el<HTMLButtonElement>('[data-export]').disabled = disabled || !report
  }
  const render = async (): Promise<void> => {
    if (busy || sweeping || destroyed) return
    busy = true; report = undefined; accepted = undefined; runError = undefined; controls(true)
    const name = el<HTMLSelectElement>('[data-fixture]').value as Fixture
    const gradient = el<HTMLSelectElement>('[data-gradient]').value as GradientPreset
    const scene = gradientScene(fixture(name), gradient)
    const settings: Settings = {
      ...DEFAULTS,
      endpointColors: gradient !== 'solid',
      pattern: el<HTMLSelectElement>('[data-pattern]').value as Pattern,
      dashLength: Number(el<HTMLSelectElement>('[data-dash-length]').value),
      dashGap: Number(el<HTMLSelectElement>('[data-dash-gap]').value),
      zoom: Number(el<HTMLSelectElement>('[data-zoom]').value),
      ratio: Number(el<HTMLSelectElement>('[data-ratio]').value),
      opacity: Number(el<HTMLSelectElement>('[data-opacity]').value),
      blend: el<HTMLSelectElement>('[data-blend]').value === 'blend',
      scaleOnZoom: el<HTMLSelectElement>('[data-scale]').value === 'yes',
      reverse: el<HTMLSelectElement>('[data-order]').value === 'reverse',
    }
    const variant = el<HTMLSelectElement>('[data-variant]').value as Variant; snapshots = {}
    status.textContent = 'Drawing and comparing every framebuffer pixel…'
    try {
      if (!backends.webgl || !backends.webgpu) throw new Error('Both backends are required; see device availability below')
      const controlsPair: Partial<Pair> = {}
      for (const lane of ['webgl', 'webgpu'] as const) {
        const backend = backends[lane]!
        controlsPair[lane] = await backend.render(scene, settings, 'production', variant === 'production')
        snapshots[lane] = variant === 'production' ? controlsPair[lane] : await backend.render(scene, settings, variant)
        el(`[data-state="${lane}"]`).textContent = 'Rendered'
      }
      const pair = snapshots as Pair; const original = controlsPair as Pair
      const comparison = await compare(pair.webgl, pair.webgpu, scene, settings)
      const production = variant === 'production' ? comparison : await compare(original.webgl, original.webgpu, scene, settings)
      const compatibility = variant === 'production' ? production : await compare(original.webgl, pair.webgpu, scene, settings)
      const preservation = { webgl: compareColors(original.webgl.color, pair.webgl.color), webgpu: compareColors(original.webgpu.color, pair.webgpu.color) }
      const sourceVisibility = await contributions(backends as { webgl: Backend; webgpu: Backend }, pair, scene, settings, variant)
      if (destroyed) return
      accepted = comparison.passed && preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 &&
        sourceVisibility.webgl === 0 && sourceVisibility.webgpu === 0
      report = {
        schemaVersion: 1,
        experiment: 'straight-links',
        recordedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        devices: Object.fromEntries(Object.entries(backends).map(([name, b]) => [name, b.info])),
        fixture: name,
        scene,
        settings,
        variant,
        contract: validationContracts['straight-links'],
        sourceAlphaPolicy: {
          ...SOURCE_BYTE_PICKING_POLICY,
          alpha: 'linkAlpha * globalOpacity * thinAlpha * coverage; f32',
          picking: 'analytic half-width; blended source byte > 0; hard mode also requires original coverage >= 0.5',
        },
        comparison,
        production,
        compatibility,
        preservation,
        sourceVisibility,
        nanEncoding: 'NaN channel sentinels export as the string NaN',
      }
      const row = (name: string, c: Comparison): string => `<tr><td>${name}</td><td>${c.passed ? 'Pass' : 'Fail'}</td><td>${c.idDifferences}</td>
        <td>${c.masks.webgl} / ${c.masks.webgpu}</td><td>${c.colors.budgetFailures} · ${c.colors.maxChannelError}/255</td>
        <td>${c.cpuColors.webgl.budgetFailures} / ${c.cpuColors.webgpu.budgetFailures}</td><td>${c.invisible.webgl} / ${c.invisible.webgpu}</td></tr>`
      el('[data-results]').innerHTML = `<h3>Full-frame audit</h3><p>${comparison.pixels.toLocaleString()} pixel positions per backend.
        Current rule: ${variant === 'production' ? 'padded production host IDs' : 'visible half-coverage contour and source-byte eligibility'}.</p>
        <table data-frame><thead><tr><th>Comparison</th><th>Result</th><th>ID differences</th><th>CPU masks · GL / GPU</th><th>GPU color failures · max</th>
        <th>CPU color failures · GL / GPU</th><th>Invisible picks · GL / GPU</th></tr></thead><tbody>${row('Current paths', comparison)}
        ${row('Production controls', production)}${variant === 'visible' ? row('Production GL / candidate GPU', compatibility) : ''}</tbody></table>
        <h3>Color preservation and picked source</h3><table data-preservation><thead><tr><th>Backend</th><th>Changed color pixels</th>
        <th>Faint-source invisible picks</th><th>Result</th></tr></thead><tbody>${(['webgl', 'webgpu'] as const).map(lane => `<tr><td>${lane}</td>
          <td>${preservation[lane].changedPixels}</td><td>${sourceVisibility[lane]}</td>
          <td>${preservation[lane].changedPixels === 0 && sourceVisibility[lane] === 0 ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table>
        ${comparison.firstMismatch
    ? `<p>First rejected pixel (${comparison.firstMismatch.x}, ${comparison.firstMismatch.y}):
          WebGL ${comparison.firstMismatch.webgl ?? 'background'}, WebGPU ${comparison.firstMismatch.webgpu ?? 'background'};
          CPU ${comparison.firstMismatch.expected.webgl ?? 'background'} / ${comparison.firstMismatch.expected.webgpu ?? 'background'}.</p>`
    : ''}`
      status.textContent = accepted
        ? 'Passed: exact IDs and CPU masks, colors within 2/255, no invisible source picks; color bytes preserved.'
        : 'Differences found. This configuration is not accepted; inspect the framebuffer, source and preservation counts.'
    } catch (error) { runError = String(error); status.textContent = runError } finally {
      busy = false; if (destroyed) dispose(); else controls(false)
    }
  }
  host.querySelectorAll<HTMLSelectElement>('select').forEach(s => s.addEventListener('change', () => { render().catch(error => { runError = String(error) }) }))
  el('[data-compare]').addEventListener('click', () => { render().catch(error => { runError = String(error) }) })
  for (const lane of ['webgl', 'webgpu'] as const) {
    const canvas = el<HTMLCanvasElement>(`[data-canvas="${lane}"]`)
    canvas.addEventListener('pointermove', event => {
      const snapshot = snapshots[lane]; if (!snapshot || busy || sweeping) return
      const bounds = canvas.getBoundingClientRect(); const x = Math.floor((event.clientX - bounds.left) / bounds.width * snapshot.width)
      const y = Math.floor((event.clientY - bounds.top) / bounds.height * snapshot.height)
      for (const target of ['webgl', 'webgpu'] as const) {
        const image = snapshots[target]; const cursor = el(`[data-cursor="${target}"]`); const box = el(`canvas[data-canvas="${target}"]`)
        cursor.hidden = false; cursor.style.left = `${(x + 0.5) / snapshot.width * box.clientWidth}px`
        cursor.style.top = `${(y + 0.5) / snapshot.height * box.clientHeight}px`
        const id = image ? pick(image, x, y) : undefined
        const label = id === undefined ? 'unavailable' : id === null ? 'background' : `link ${id}`
        el(`[data-pick="${target}"]`).textContent = `Pixel (${x}, ${y}) · ${label}`
      }
    })
    canvas.addEventListener('pointerleave', () => { host.querySelectorAll<HTMLElement>('[data-cursor]').forEach(c => { c.hidden = true }) })
  }
  el('[data-export]').addEventListener('click', () => {
    if (!report || busy || sweeping) return
    const json = JSON.stringify({
      ...report,
      sweep: study,
      hardCoverageReplay: hardReplay,
      rasterReplay,
      reproduction: { defaults: DEFAULTS, fixtures: FIXTURES.map(name => ({ name, scene: gradientScene(fixture(name), study?.gradient ?? 'solid') })) },
    },
    (key, value) => typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a')
    link.href = url; link.download = 'cosmos-straight-links.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  el('[data-cancel]').addEventListener('click', () => { cancelled = true })
  el('[data-sweep]').addEventListener('click', () => {
    if (busy || sweeping || destroyed || !backends.webgl || !backends.webgpu) return
    const run = async (): Promise<void> => {
      sweeping = true; cancelled = false; controls(true); el<HTMLButtonElement>('[data-cancel]').disabled = false
      const current = {
        gradient: el<HTMLSelectElement>('[data-gradient]').value as GradientPreset,
        patternSettings: {
          pattern: el<HTMLSelectElement>('[data-pattern]').value as Pattern,
          dashLength: Number(el<HTMLSelectElement>('[data-dash-length]').value),
          dashGap: Number(el<HTMLSelectElement>('[data-dash-gap]').value),
        },
        startedAt: new Date().toISOString(),
        finishedAt: undefined as string | undefined,
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as Row[],
        error: undefined as string | undefined,
      }
      study = current; el('[data-sweep-results]').replaceChildren(); el('[data-progress]').textContent = `Starting ${ROW_COUNT} straight-link cases…`
      try {
        await runSweep(backends as { webgl: Backend; webgpu: Backend }, row => {
          current.rows.push(row); if (destroyed) return
          renderRows(el('[data-sweep-results]'), current.rows)
          const mode = row.settings.blend ? 'blended' : 'hard'
          el('[data-progress]').textContent = `${current.rows.length} / ${ROW_COUNT} · ${row.fixture} · ${row.profile} · ${mode}`
        }, () => cancelled || destroyed, current.gradient, current.patternSettings)
        current.status = cancelled || destroyed ? 'cancelled' : 'complete'
      } catch (error) { current.status = 'failed'; current.error = String(error); runError = current.error } finally {
        current.finishedAt = new Date().toISOString(); sweeping = false
        if (destroyed) dispose()
        else {
          controls(false); el<HTMLButtonElement>('[data-cancel]').disabled = true
          const rejected = current.rows.filter(r => !r.passed).length
          el('[data-progress]').textContent = `${current.status} · ${current.rows.length} / ${ROW_COUNT} · ${rejected} candidate cases rejected.`
        }
      }
    }
    run().catch(error => { runError = String(error) })
  })
  el('[data-hard-cancel]').addEventListener('click', () => { cancelled = true })
  el('[data-hard-replay]').addEventListener('click', () => {
    if (busy || sweeping || destroyed || !backends.webgl || !backends.webgpu) return
    const run = async (): Promise<void> => {
      sweeping = true; cancelled = false; controls(true); el<HTMLButtonElement>('[data-hard-cancel]').disabled = false
      const current = {
        startedAt: new Date().toISOString(),
        finishedAt: undefined as string | undefined,
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as HardRow[],
        error: undefined as string | undefined,
      }
      hardReplay = current; el('[data-hard-output]').replaceChildren(); el('[data-hard-progress]').textContent = 'Starting nine isolated comparisons…'
      try {
        await replayHardCoverage(backends as { webgl: Backend; webgpu: Backend }, row => {
          current.rows.push(row); if (destroyed) return
          renderHardCoverage(el('[data-hard-output]'), current.rows)
          el('[data-hard-progress]').textContent = `${current.rows.length} / 9 · ${row.name} · ${row.method}`
        }, () => cancelled || destroyed)
        current.status = cancelled || destroyed ? 'cancelled' : 'complete'
      } catch (error) { current.status = 'failed'; current.error = String(error); runError = current.error } finally {
        current.finishedAt = new Date().toISOString(); sweeping = false
        if (destroyed) dispose()
        else {
          controls(false); el<HTMLButtonElement>('[data-hard-cancel]').disabled = true
          const accepted = current.rows.filter(row => row.passed).length
          el('[data-hard-progress]').textContent = `${current.status} · ${current.rows.length} / 9 compared · ${accepted} pass all retained gates. ` +
            'Live settings and canvases preserved.'
        }
      }
    }
    run().catch(error => { runError = String(error) })
  })
  el('[data-raster-cancel]').addEventListener('click', () => { cancelled = true })
  el('[data-raster-replay]').addEventListener('click', () => {
    if (busy || sweeping || destroyed || !backends.webgl || !backends.webgpu) return
    const run = async (): Promise<void> => {
      sweeping = true; cancelled = false; controls(true); el<HTMLButtonElement>('[data-raster-cancel]').disabled = false
      const current = {
        startedAt: new Date().toISOString(),
        finishedAt: undefined as string | undefined,
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as RasterRow[],
        error: undefined as string | undefined,
      }
      rasterReplay = current; el('[data-raster-output]').replaceChildren()
      el('[data-raster-progress]').textContent = `Starting ${RASTER_ROWS} cap/raster cases…`
      try {
        await replayRaster(backends as { webgl: Backend; webgpu: Backend }, row => {
          current.rows.push(row); if (destroyed) return
          renderRaster(el('[data-raster-output]'), current.rows)
          el('[data-raster-progress]').textContent = `${current.rows.length} / ${RASTER_ROWS} · ${row.name} · ${row.variant}`
        }, () => cancelled || destroyed)
        current.status = cancelled || destroyed ? 'cancelled' : 'complete'
      } catch (error) { current.status = 'failed'; current.error = String(error); runError = current.error } finally {
        current.finishedAt = new Date().toISOString(); sweeping = false
        if (destroyed) dispose()
        else {
          controls(false); el<HTMLButtonElement>('[data-raster-cancel]').disabled = true
          const accepted = current.rows.filter(row => row.passed).length
          const state = `${current.status} · ${current.rows.length} / ${RASTER_ROWS} compared`
          el('[data-raster-progress]').textContent = `${state} · ${accepted} pass all retained gates. ` +
            'Live settings and canvases preserved.'
        }
      }
    }
    run().catch(error => { runError = String(error) })
  })
  mountRunLayout(host, () => summarizeRun(busy || sweeping ? 'Running' : report ? 'Complete' : 'Preparing', [accepted],
    'Other color modes, curves, patterns, arrows, transitions, pointer-window behavior, wider devices and runtime GPU cost.',
    Object.keys(backends).length === 2 ? [] : ['Missing backend'], runError, 'straight-ribbon full-frame comparison'),
  { experiment: 'straight-links', devices: () => Object.values(backends).map(b => b.info) })
  compactRunControls(host, {
    diagnostics: true,
    settings: ['[data-dash-length]', '[data-dash-gap]', '[data-gradient]',
      '[data-zoom]', '[data-ratio]', '[data-opacity]', '[data-scale]', '[data-order]'],
  })
  for (const [lane, create] of [['webgl', createLinksWebGL], ['webgpu', createLinksWebGPU]] as const) {
    try {
      backends[lane] = await create(el<HTMLCanvasElement>(`[data-canvas="${lane}"]`))
      el(`[data-device="${lane}"]`).textContent = backends[lane].info
    } catch (error) {
      el(`[data-state="${lane}"]`).textContent = 'Unavailable'; el(`[data-device="${lane}"]`).textContent = String(error)
    }
  }
  await render()
  return {
    pause: (): void => { cancelled = true },
    destroy: (): void => {
      destroyed = true; cancelled = true; disposeRunLayout(host); if (!busy && !sweeping) dispose()
    },
  }
}
