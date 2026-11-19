import { PATTERNS, type Pattern } from '../straight-links/patterns'
import { GRADIENT_PRESETS, GRADIENT_LABELS, gradientScene, type GradientPreset } from '../straight-links/gradient-fixtures'
import type { ExperimentInstance } from '../../runtime/experiment'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import { compactRunControls } from '../../runtime/compact-controls'
import { validationContracts } from '../../runtime/validation'
import { pick } from '../../gpu/rgba-readback'
import { DEFAULTS, FIXTURES, PROFILES, fixture, WIDTH, HEIGHT, type Settings, type Fixture, type Variant } from './data'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'
import { assess, runSweep, renderRows, ROW_COUNT, type Pair, type Evidence, type Row } from './study'
import type { Backend } from './backend'
import type { Comparison } from './reference'
import { investigateBow, renderBowReport, type BowReport } from './boundary'
function renderEvidence (host: HTMLElement, evidence: Evidence): void {
  const row = (label: string, c: Comparison, passed: boolean): string => `<tr><td>${label}</td><td>${passed ? 'Pass' : 'Fail'}</td>
    <td>${c.idDifferences}</td><td>${c.masks.webgl} / ${c.masks.webgpu}</td><td>${c.colors.budgetFailures}</td>
    <td>${c.cpuColors.webgl.budgetFailures} / ${c.cpuColors.webgpu.budgetFailures}</td><td>${c.invisible.webgl} / ${c.invisible.webgpu}</td></tr>`
  host.innerHTML = `<h3>Full-frame comparison</h3><p>${evidence.triangles} CPU reference triangles before culling.
    Production and candidate color use the same draw. Padded host IDs remain a separate control.</p>
    <table data-curves-frame><thead><tr><th>Policy / comparison</th><th>Result</th><th>IDs</th><th>CPU masks · GL / GPU</th>
      <th>GPU color failures</th><th>CPU color failures · GL / GPU</th><th>Invisible picks · GL / GPU</th></tr></thead><tbody>
      ${row('Production IDs · WebGL / WebGPU', evidence.production, evidence.productionPassed)}
      ${row('Previous visible IDs · WebGL / WebGPU', evidence.candidate, evidence.passed)}
      ${row('Color-face IDs · WebGL / WebGPU', evidence.front, evidence.frontPassed)}
      ${row('Production GL / candidate GPU', evidence.compatibility, evidence.compatibility.passed)}</tbody></table>
    <h3>Original color and source visibility</h3><table data-curves-sources><thead><tr><th>Backend / candidate</th><th>Changed original color</th>
      <th>Invisible source · production / candidate</th><th>Invalid source IDs · production / candidate</th></tr></thead><tbody>
    ${(['webgl', 'webgpu'] as const).map(lane => `<tr><td>${lane} · previous visible</td><td>${evidence.preservation[lane].changedPixels}</td>
      <td>${evidence.sourceVisibility.production[lane]} / ${evidence.sourceVisibility.candidate[lane]}</td>
      <td>${evidence.sourceVisibility.production.unknown[lane]} / ${evidence.sourceVisibility.candidate.unknown[lane]}</td></tr>`).join('')}
    ${(['webgl', 'webgpu'] as const).map(lane => `<tr><td>${lane} · color-face</td><td>${evidence.frontPreservation[lane].changedPixels}</td>
      <td>${evidence.sourceVisibility.production[lane]} / ${evidence.frontSources[lane]}</td>
      <td>${evidence.sourceVisibility.production.unknown[lane]} / ${evidence.frontSources.unknown[lane]}</td></tr>`).join('')}</tbody></table>
    ${evidence.candidate.firstMismatch ? `<p>First ID/mask rejection: (${evidence.candidate.firstMismatch.x}, ${evidence.candidate.firstMismatch.y}).</p>` : ''}
    ${evidence.candidate.firstColorMismatch
    ? `<p>First color rejection: (${evidence.candidate.firstColorMismatch.x}, ${evidence.candidate.firstColorMismatch.y});
      RGBA8 · GL ${evidence.candidate.firstColorMismatch.webgl.join(', ')}; GPU ${evidence.candidate.firstColorMismatch.webgpu.join(', ')};
      CPU ${evidence.candidate.firstColorMismatch.cpu.join(', ')}.</p>`
    : ''}`
}

export async function createCurvesView (host: HTMLElement): Promise<ExperimentInstance> {
  const select = (label: string, name: string, values: Array<string | number>, current: string | number): string =>
    `<label>${label} <select data-${name}>${values.map(v => `<option${v === current ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar styling-toolbar">
    <label>Stroke <select data-pattern>${PATTERNS.map(p => `<option value="${p}">${p}</option>`).join('')}</select>
      <span class="control-guidance">Production IDs include gaps; the visible-pixel candidate checks patterned paint.</span></label>
    <label>Dash length <select data-dash-length><option>3.5</option><option selected>5</option><option>12</option></select></label>
    <label>Pattern gap <select data-dash-gap><option>0</option><option>3.25</option><option selected>5</option></select></label>
    <label>Color source <select data-gradient>${GRADIENT_PRESETS.map((p, i) =>
    `<option value="${p}">${GRADIENT_LABELS[i]}</option>`).join('')}</select>
      <span class="control-guidance">RGB follows the ribbon parameter. Link alpha controls opacity; endpoint alpha is ignored.</span></label>
    <label>Picking rule <select data-variant><option value="front">Color-face candidate</option>
      <option value="visible">Previous visible candidate · both faces</option>
      <option value="production">Production · padded host IDs</option></select></label>
    ${select('Fixture', 'fixture', [...FIXTURES], 'bows')}${select('Segments', 'segments', [1, 3, 8, 19, 32], 19)}
    ${select('Curve weight', 'weight', [0.2, 0.8, 1, 1.5], 0.8)}${select('Control distance', 'distance', [-0.5, 0, 0.25, 0.5, 0.75], 0.5)}
    ${select('Zoom', 'zoom', [0.5, 1, 2], 1)}${select('Pixel ratio', 'ratio', [1, 2], 1)}${select('Link opacity', 'opacity', [0, 0.35, 1], 1)}
    <label>Rendering <select data-blend><option value="blend">Blended · antialiased</option><option value="hard">Opaque · hard edges</option></select></label>
    <label>Width on zoom <select data-scale><option value="yes">Scale with camera</option><option value="no">Constant screen width</option></select></label>
    <label>Draw order <select data-order><option value="normal">Input order</option><option value="reverse">Reversed</option></select></label>
    <div class="controls"><button data-compare data-run-action="primary">Compare</button>
      <button data-export data-run-action="export" disabled>Export JSON</button></div></div>
    <p role="status" data-run-part="status">Creating luma devices…</p>
    <section data-run-part="visualization" class="backend-panels styling-panels">
    ${(['webgl', 'webgpu'] as const).map(lane => `<article class="backend-panel"><div class="panel-heading">
      <h2>${lane === 'webgl' ? 'Cosmos WebGL' : 'luma WebGPU'}</h2><span data-state="${lane}">Starting…</span></div>
      <div class="styling-viewport"><canvas data-canvas="${lane}" width="${WIDTH}" height="${HEIGHT}" aria-label="${lane} curved solid links"></canvas>
      <span class="styling-cursor" data-cursor="${lane}" hidden></span></div>
      <p class="styling-pick" data-pick="${lane}">Move over a curve to inspect its ID</p>
      <p class="demo-note" data-device="${lane}"></p></article>`).join('')}</section>
    <section data-run-part="results" data-results class="readiness-table"></section>
    <div data-run-part="explanation"><p>Rational quadratic ribbons use the production power-spaced samples and finite-difference normals.</p>
      <p>
      The production ID pass widens each curve by five CSS pixels; the separate candidate uses its visible width and source-byte eligibility.
      The color-face candidate also culls the back faces excluded from color.</p>
      <p>The selected color source, back-face culling, alpha and primitive overlap follow the production draw. Frozen positions and captured IDs
      keep pointer inspection deterministic.</p></div>
    <section data-run-part="diagnostics"><h3>Repeatable curved-link sweep</h3><p>${ROW_COUNT} configurations:
      four fixtures × eight profiles × blended/hard modes, using the selected color source and stroke.
      The boundary replay keeps its recorded solid control.
      CPU checks rasterize the actual tessellated triangle strip. All selected source links are checked in isolation, including folded ribbons.</p>
      <div class="controls"><button data-sweep disabled>Run curved-link sweep</button><button data-cancel disabled>Cancel sweep</button></div>
      <p data-progress>No sweep run.</p><div data-sweep-results class="readiness-table"></div>
      <h3>Default-bow boundary investigation</h3><p>Replay the isolated amber source at pixel (352, 85) with identical captured vertices.
        Original images, controls and acceptance masks stay unchanged. This uses fixed production-default curve parameters.</p>
      <button data-bow-replay disabled>Replay default-bow pixel</button><p data-bow-progress>No boundary replay run.</p>
      <div data-bow-results class="readiness-table"></div></section>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const backends: Partial<Record<'webgl' | 'webgpu', Backend>> = {}; let snapshots: Partial<Pair> = {}
  const status = el('[role="status"]'); let busy = false; let sweeping = false; let cancelled = false; let destroyed = false; let disposed = false
  let replaying = false; let bowReplay: BowReport | undefined
  let accepted: boolean | undefined; let error: string | undefined; let report: object | undefined
  let study: { patternSettings: Pick<Settings, 'pattern' | 'dashLength' | 'dashGap'>;
    gradient: GradientPreset; startedAt: string; finishedAt?: string; status: string; rows: Row[];
    browser: string; devices: string[]; error?: string; } | undefined
  const dispose = (): void => { if (!disposed) { disposed = true; Object.values(backends).forEach(b => b.destroy()) } }
  const controls = (disabled: boolean): void => {
    host.querySelectorAll<HTMLSelectElement>('select').forEach(s => { s.disabled = disabled })
    el<HTMLButtonElement>('[data-compare]').disabled = disabled
    el<HTMLButtonElement>('[data-sweep]').disabled = disabled || !backends.webgl || !backends.webgpu
    el<HTMLButtonElement>('[data-export]').disabled = disabled || !report
    el<HTMLButtonElement>('[data-bow-replay]').disabled = disabled || !backends.webgl || !backends.webgpu
  }
  const value = (key: string): string => el<HTMLSelectElement>(`[data-${key}]`).value
  const render = async (): Promise<void> => {
    if (busy || sweeping || replaying || destroyed) return
    busy = true; accepted = undefined; error = undefined; report = undefined; snapshots = {}; controls(true)
    status.textContent = 'Drawing the curve mesh and checking every framebuffer pixel…'
    try {
      if (!backends.webgl || !backends.webgpu) throw new Error('Both backends are required; see device availability')
      const name = value('fixture') as Fixture; const gradient = value('gradient') as GradientPreset
      const scene = gradientScene(fixture(name), gradient); const variant = value('variant') as Variant
      const settings: Settings = {
        ...DEFAULTS,
        endpointColors: gradient !== 'solid',
        pattern: el<HTMLSelectElement>('[data-pattern]').value as Pattern,
        dashLength: Number(el<HTMLSelectElement>('[data-dash-length]').value),
        dashGap: Number(el<HTMLSelectElement>('[data-dash-gap]').value),
        segments: Number(value('segments')),
        weight: Number(value('weight')),
        controlDistance: Number(value('distance')),
        zoom: Number(value('zoom')),
        ratio: Number(value('ratio')),
        opacity: Number(value('opacity')),
        blend: value('blend') === 'blend',
        scaleOnZoom: value('scale') === 'yes',
        reverse: value('order') === 'reverse',
      }
      const { frames, evidence } = await assess(backends as { webgl: Backend; webgpu: Backend }, scene, settings, variant)
      if (destroyed) return
      snapshots = frames[variant]; accepted = variant === 'front' ? evidence.frontPassed : variant === 'visible' ? evidence.passed : evidence.productionPassed
      report = {
        schemaVersion: 2,
        experiment: 'curved-links',
        recordedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        devices: Object.fromEntries(Object.entries(backends).map(([lane, b]) => [lane, b.info])),
        fixture: name,
        scene,
        settings,
        variant,
        contract: validationContracts['curved-links'],
        ...evidence,
        nanEncoding: 'NaN sentinels export as the string NaN',
      }
      for (const lane of ['webgl', 'webgpu']) el(`[data-state="${lane}"]`).textContent = 'Rendered'
      renderEvidence(el('[data-results]'), evidence)
      status.textContent = accepted
        ? 'Selected policy passed: exact IDs and CPU masks, colors within 2/255 and no invisible source picks.'
        : 'Differences found. The selected policy is not accepted; all rejected mask, color and source checks remain visible.'
    } catch (failure) { error = String(failure); status.textContent = error } finally {
      busy = false; if (destroyed) dispose(); else controls(false)
    }
  }
  host.querySelectorAll<HTMLSelectElement>('select').forEach(s => {
    s.addEventListener('change', () => { render().catch(failure => { error = String(failure) }) })
  })
  el('[data-compare]').addEventListener('click', () => { render().catch(failure => { error = String(failure) }) })
  for (const lane of ['webgl', 'webgpu'] as const) {
    const canvas = el<HTMLCanvasElement>(`[data-canvas="${lane}"]`)
    canvas.addEventListener('pointermove', event => {
      const source = snapshots[lane]; if (!source || busy || sweeping || replaying) return
      const bounds = canvas.getBoundingClientRect(); const x = Math.floor((event.clientX - bounds.left) / bounds.width * source.width)
      const y = Math.floor((event.clientY - bounds.top) / bounds.height * source.height)
      for (const target of ['webgl', 'webgpu'] as const) {
        const image = snapshots[target]; const cursor = el(`[data-cursor="${target}"]`); const box = el(`canvas[data-canvas="${target}"]`)
        cursor.hidden = false; cursor.style.left = `${(x + 0.5) / source.width * box.clientWidth}px`
        cursor.style.top = `${(y + 0.5) / source.height * box.clientHeight}px`
        const id = image ? pick(image, x, y) : undefined; const label = id === undefined ? 'unavailable' : id === null ? 'background' : `link ${id}`
        el(`[data-pick="${target}"]`).textContent = `Pixel (${x}, ${y}) · ${label}`
      }
    })
    canvas.addEventListener('pointerleave', () => { host.querySelectorAll<HTMLElement>('[data-cursor]').forEach(c => { c.hidden = true }) })
  }
  el('[data-export]').addEventListener('click', () => {
    if (!report || busy || sweeping || replaying) return
    const data = {
      ...report,
      sweep: study,
      bowReplay,
      reproduction: {
        defaults: DEFAULTS,
        profiles: PROFILES,
        fixtures: FIXTURES.map(name => ({ name, scene: gradientScene(fixture(name), study?.gradient ?? 'solid') })),
      },
    }
    const json = JSON.stringify(data, (key, value) => typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a')
    link.href = url; link.download = 'cosmos-curved-links.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  el('[data-cancel]').addEventListener('click', () => { cancelled = true })
  el('[data-sweep]').addEventListener('click', () => {
    if (busy || sweeping || replaying || destroyed || !backends.webgl || !backends.webgpu) return
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
        rows: [] as Row[],
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        error: undefined as string | undefined,
      }
      study = current; el('[data-sweep-results]').replaceChildren(); el('[data-progress]').textContent = `Starting ${ROW_COUNT} curved-link cases…`
      try {
        await runSweep(backends as { webgl: Backend; webgpu: Backend }, row => {
          current.rows.push(row); if (destroyed) return
          renderRows(el('[data-sweep-results]'), current.rows)
          el('[data-progress]').textContent = `${current.rows.length} / ${ROW_COUNT} · ${row.fixture} · ${row.profile} · ${
            row.settings.blend ? 'blended' : 'hard'}`
        }, () => cancelled || destroyed, current.gradient, current.patternSettings)
        current.status = cancelled || destroyed ? 'cancelled' : 'complete'
      } catch (failure) { current.status = 'failed'; current.error = String(failure); error = current.error } finally {
        current.finishedAt = new Date().toISOString(); sweeping = false
        if (destroyed) dispose()
        else {
          controls(false); el<HTMLButtonElement>('[data-cancel]').disabled = true
          el('[data-progress]').textContent = `${current.status} · ${current.rows.length} / ${ROW_COUNT} · ` +
            `${current.rows.filter(r => !r.frontPassed).length} rejected.`
        }
      }
    }
    run().catch(failure => { error = String(failure) })
  })
  el('[data-bow-replay]').addEventListener('click', () => {
    if (busy || sweeping || replaying || destroyed) return
    const run = async (): Promise<void> => {
      replaying = true; controls(true); el('[data-bow-progress]').textContent = 'Capturing vertices and replaying identical geometry…'
      try {
        bowReplay = await investigateBow()
        if (!destroyed) { renderBowReport(el('[data-bow-results]'), bowReplay); el('[data-bow-progress]').textContent = 'Complete · 9 replay rows.' }
      } catch (failure) { error = String(failure); if (!destroyed) el('[data-bow-progress]').textContent = error } finally {
        replaying = false; if (destroyed) dispose(); else controls(false)
      }
    }
    run().catch(failure => { error = String(failure) })
  })
  mountRunLayout(host, () => summarizeRun(busy || sweeping || replaying ? 'Running' : report ? 'Complete' : 'Preparing', [accepted],
    'Other color/stroke settings, arrows, distance fading, highlights, transitions, full Graph integration, GPU cost and native portability.',
    Object.keys(backends).length === 2 ? [] : ['Missing backend'], error, 'curved-ribbon full-frame comparison'),
  { experiment: 'curved-links', devices: () => Object.values(backends).map(b => b.info) })
  compactRunControls(host, {
    diagnostics: true,
    settings: ['[data-dash-length]', '[data-dash-gap]', '[data-gradient]', '[data-segments]', '[data-weight]', '[data-distance]',
      '[data-zoom]', '[data-ratio]', '[data-opacity]', '[data-scale]', '[data-order]'],
  })
  controls(true)
  for (const [lane, create] of [['webgl', createCurvesWebGL], ['webgpu', createCurvesWebGPU]] as const) {
    try {
      backends[lane] = await create(el<HTMLCanvasElement>(`[data-canvas="${lane}"]`)); el(`[data-device="${lane}"]`).textContent = backends[lane].info
    } catch (failure) { el(`[data-state="${lane}"]`).textContent = 'Unavailable'; el(`[data-device="${lane}"]`).textContent = String(failure) }
  }
  await render()
  return {
    pause: (): void => { cancelled = true },
    destroy: (): void => {
      destroyed = true; cancelled = true; disposeRunLayout(host); if (!busy && !sweeping && !replaying) dispose()
    },
  }
}
