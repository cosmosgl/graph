import { checkResult, count as formatCount } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { pointStylingExportContract } from '../../runtime/validation'
import { mountPixelInspector } from '../../runtime/pixel-inspector'
import { runFilteredAlphaCost, renderFilteredAlphaCost, type FilteredAlphaCostRow } from './stored-alpha-filter-study'
import { runStoredAlphaCost, renderStoredAlphaCost, STORED_ALPHA_COST_POLICY, type StoredAlphaCostRow } from './stored-alpha-cost'
import { storedAlphaReplay, renderStoredAlphaRows, type StoredAlphaRow } from './stored-alpha-study'
import type { Backend, Snapshot, RenderVariant } from './backend'
import { DEFAULTS, fixture, HEIGHT, WIDTH, type Settings } from './data'
import { initializeStylingCase, refreshStylingCase, type SecondaryStylingCase } from './case-view'
import { COLOR_BUDGET, atlasCpuColors, compareColors, compareSnapshotsAsync } from './reference'
import { effectScenario, EFFECTS_FIXTURES, EFFECTS_PROFILES, EFFECTS_VIEWS, type EffectsFixture } from './effects-fixtures'
import { effectsCpuColors } from './effects-reference'
import { auditPolygons, renderPolygonAudit } from './polygon-audit'
import { EFFECTS_SOURCE_ALPHA } from './point-effects'
import { EFFECTS_ROW_COUNT, runEffectsSweep, renderEffectsRows, type EffectsRow } from './effects-study'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { renderExplicitControl } from './explicit'
import { SOURCE_ALPHA_POLICY, SOURCE_BYTE_PICKING_POLICY } from './source-alpha'
import { ATLAS_EXPORT, ATLAS_PICKING_POLICY, ATLAS_QUANTIZED_POLICY, ATLAS_ISOLATION_EXPORT, sourceTexelRects } from './atlas'
import { PACKING_NAMES, packingExport, packingLayout, type AtlasLayout } from './atlas-packing'
import { DECODE_POLICIES, decodeImages, installDecoded, auditDecoded, renderDecodeAudit, type DecodedImages, type DecodePolicy } from './image-decoding'
import { DECODING_PROFILES, DECODING_ROW_COUNT, decodingPoints, runDecodingSweep, renderDecodingRows, type DecodingRow } from './decoding-study'
import { DECODE_SPACES, DECODE_PIXELS } from './decode-fixtures'
import {
  applyDynamicStep, DYNAMIC_STEPS, DYNAMIC_PROFILES, DYNAMIC_ROW_COUNT, dynamicPoints, runDynamicSweep, renderDynamicRows,
  type DynamicRow,
} from './dynamic-study'
import {
  PACKING_FIXTURES, PACKING_PROFILES, PACKING_POLICIES, PACKING_ROW_COUNT, renderPackingRows, runPackingSweep, type PackingRow,
} from './atlas-packing-study'
import { inspectAtlasIsolation, renderIsolationRows, runIsolationSweep, type IsolationRow } from './atlas-isolation'
import { ATLAS_FIXTURES, ATLAS_PROFILES, renderAtlasRows, runAtlasSweep, type AtlasRow } from './atlas-study'
import {
  contributionPasses, inspectForeground, renderContributionAudit, renderTinyAlphaRows, runTinyAlphaSweep, TINY_OPACITIES,
  type TinyAlphaRow,
} from './tiny-alpha'

export async function createStylingView (host: HTMLElement, caseId: SecondaryStylingCase): Promise<ExperimentInstance> {
  let runError: string | undefined
  const experiment = 'point-styling'
  host.innerHTML = `<div
      data-run-part="configuration" class="scale-toolbar styling-toolbar">
      <label>Renderer <select data-renderer><option value="production">Production control</option>
        <option value="explicit">Explicit-coordinate candidate</option><option value="quantized">Source-alpha quantized candidate</option>
        <option value="eligibility">Source-byte picking candidate</option></select></label>
      <label>Scene <select data-fixture><option value="shapes">Eight shapes · fill and stroke</option>
        <option value="point-effects">Point rings and greyout</option><option value="overlap">Overlap and draw order</option>
        <option value="edge-cases">Defaults and edge cases</option>
        <option value="tiny-alpha">Tiny-alpha grid</option>
        <option value="tiny-overlap">Tiny-alpha overlap</option><option value="alpha-stack">Faint overlap stack · 64 points</option>
        <option value="atlas-images">Atlas · image-only points</option><option value="atlas-shapes">Atlas · image over shape</option>
        <option value="atlas-overlap">Atlas · overlapping points</option><option value="atlas-edges">Atlas · filtering and tile edges</option>
        <option value="atlas-decoding">Atlas · image decoding and color</option>
        <option value="atlas-dynamic">Atlas · dynamic image updates</option>
        <option value="atlas-packing-grid">Packing · five non-square images</option>
        <option value="atlas-packing-edges">Packing · exact texel boundaries</option>
        <option value="atlas-packing-overlap">Packing · overlap and underlying shapes</option></select></label>
      <label>Ring / greyout scene <select data-effects-scene disabled>${EFFECTS_FIXTURES.map(name =>
    `<option value="${name}">${name === 'shapes' ? 'Eight shapes · exact boundary control' : name}</option>`).join('')}</select></label>
      <label>Ring / greyout profile <select data-effects-profile disabled>${EFFECTS_PROFILES.map((p, i) =>
    `<option value="${i}">${p.name}</option>`).join('')}</select></label>
      <label>Hover / focus distance <select data-overlay-arithmetic disabled><option value="normalized">Interpolated · retained control</option>
        <option value="pixels">Pixel distance · candidate</option></select></label>
      <label>Polygon arithmetic <select data-polygon-arithmetic disabled><option value="normalized">Normalized · retained control</option>
        <option value="pixels">Pixel-space · diagnostic</option></select></label>
      <label>Atlas filter <select data-image-filter><option value="nearest">Nearest · production default</option>
        <option value="linear">Linear</option></select></label>
      <label>Decode / upload <select data-decode-policy disabled>${DECODE_POLICIES.map(p =>
    `<option value="${p.id}">${p.label}</option>`).join('')}</select></label>
      <label>Atlas packing <select data-atlas-packing><option value="baseline">Baseline · 64 × 64</option>
        <option value="npot-square">Production grid · 93 × 93</option><option value="npot-rectangle">Rectangular · 93 × 62</option>
        <option value="npot-scaled">Production scaled · 62 × 62</option><option value="pot-padded">Padded control · 128 × 128</option></select></label>
      <label>Candidate atlas sampling <select data-atlas-isolation><option value="original">Original · control</option>
        <option value="clamp">Clamp to tile texel centers</option><option value="inset">Inset UV remap · control</option>
        <option value="gutter">Duplicate-edge gutters</option><option value="texel">Source texels · nearest</option></select></label>
      <label>Zoom <select data-zoom><option>0.5</option><option selected>1</option><option>2</option></select></label>
      <label>Pixel ratio <select data-ratio><option selected>1</option><option>2</option></select></label>
      <label>Size on zoom <select data-scale><option value="yes">Scale with camera</option>
        <option value="no">Cosmos constant-size rule</option></select></label>
      <label>Global opacity <select data-opacity><option selected>1</option><option>0.35</option><option>0</option>
        ${TINY_OPACITIES.filter(x => x > 0 && x < 0.35).map(x => `<option value="${x}">${x.toPrecision(5)}</option>`).join('')}</select></label>
      <label>Draw order <select data-order><option value="normal">Input order</option><option value="reverse">Reversed</option></select></label>
      <div class="controls" data-image-actions><button data-image-next disabled>Next image update</button>
        <button data-image-reset disabled>Reset image sequence</button></div>
      <div class="controls"><button data-export disabled
      data-run-action="export">Export JSON</button></div>
    </div><p role="status"
      data-run-part="status">Creating luma devices…</p>
    ${caseId === 'picking'
    ? '<button type="button" class="button-primary" data-inspect-center data-run-action="primary" disabled>Inspect center pixel</button>'
    : ''}
    <section data-run-part="visualization"><p class="demo-note" data-inspect-feedback aria-live="polite"></p>
    <div class="backend-panels styling-panels">${(['webgl', 'webgpu'] as const).map(name => `<article class="backend-panel">
      <div class="panel-heading"><h2>${name === 'webgl' ? 'Cosmos WebGL' : 'luma WebGPU'}</h2><span class="status" data-state="${name}">Starting…</span></div>
      <div class="styling-viewport"><canvas width="${WIDTH}" height="${HEIGHT}" data-canvas="${name}"
        aria-label="${name} styled points"></canvas>
        <span class="styling-cursor" data-cursor="${name}" hidden></span></div>
      <p data-pick="${name}" class="styling-pick"></p><p class="demo-note" data-device="${name}"></p>
    </article>`).join('')}</div>
    ${caseId === 'images' ? '<p data-image-stage class="demo-note"></p>' : ''}
    <p class="demo-note" data-legend></p></section>
    <div class="many-body-results"
      data-run-part="results" data-results></div>
    ${caseId === 'picking'
    ? `<section data-run-part="diagnostics"><h3>Stored-alpha picking · bounded prototype</h3>
      <p>Replay the first alpha-byte boundary alone and over a visible point. Picking reads each point’s stored alpha;
        the explicit-coordinate color pass stays unchanged. This is a separate policy from source-byte picking.</p>
      <button data-stored-alpha disabled>Check stored-alpha picking</button>
      <p data-stored-progress aria-live="polite">Unchecked · 14 × 14 pixel region; bodies only. Three extra passes per point plus one clear.
        This checks correctness, not picking latency or migration approval.</p><div class="table-scroll" data-stored-results></div>
      <h4>Stored-alpha cost</h4>
      <p>16 bounded cases: 16–1024 points, four or all points at the pointer, both backends.
        Five normal/profiled pairs after warmup. Keep this page visible; correctness checks stay outside each measured interval.</p>
      <div class="controls"><button data-stored-cost disabled>Measure stored-alpha cost</button>
        <button data-stored-cost-cancel disabled>Cancel cost sweep</button></div>
      <p data-stored-cost-progress aria-live="polite">Unchecked · setup, encoding, synchronized completion, snapshot readback
        and GPU pass sums stay separate. Invalid timing samples remain unavailable.</p>
      <div class="table-scroll" data-stored-cost-results></div>
      <h4>Filtered stored-alpha comparison</h4>
      <p>Compare the prototype with conservative region filtering: exact IDs, unchanged colors and request cost.
        Two warmup pairs and five measured pairs per case; 16–1024 points, sparse and dense overlap, both backends.
        Filtering uses CPU-resident positions. Dense overlap may retain every point.</p>
      <div class="controls"><button data-filtered-cost disabled>Compare filtered picking</button>
        <button data-filtered-cost-cancel disabled>Cancel comparison</button></div>
      <p data-filtered-cost-progress aria-live="polite">Unchecked · request wall time includes filtering, setup, encoding and GPU completion.
        Ordinary rendering and snapshot readback are excluded. All content and controls remain unchanged.</p>
      <div class="table-scroll" data-filtered-cost-results></div>
    </section>
    <section data-run-part="diagnostics"><h3>Tiny-alpha sweep</h3>
      <p>Check tiny positive opacity, subpixel ink and faint foreground picks. Uses offscreen draws; the live canvases and settings stay in place.</p>
      <div class="controls"><button data-tiny-sweep disabled>Run tiny-alpha sweep</button><button data-tiny-cancel disabled>Cancel sweep</button></div>
      <p data-tiny-progress>No sweep run. All rows, including failures, remain visible and exportable.</p><div data-tiny-results></div></section>`
    : ''}
    ${caseId === 'images'
    ? `<section data-run-part="diagnostics">
      <h3>Image-atlas sweep</h3><p>40 cases compare production, explicit and source-byte paths, sampled CPU colors and foreground visibility.</p>
      <div class="controls"><button data-atlas-sweep disabled>Run image-atlas sweep</button><button data-atlas-cancel disabled>Cancel atlas sweep</button></div>
      <p data-atlas-progress>No atlas sweep run.</p><div data-atlas-results></div>
      <h3>Atlas tile isolation</h3><p>Compare four UV policies against separately clamped images. Production always uses its original atlas.</p>
      <div class="controls"><button data-isolation-sweep disabled>Run tile-isolation sweep</button>
        <button data-isolation-cancel disabled>Cancel isolation sweep</button></div>
      <p data-isolation-progress>No isolation sweep run.</p><div data-isolation-results></div>
      <h3>Non-square atlas packing</h3><p>144 frozen rows compare original UVs, clamping and source-texel addressing across four layouts.</p>
      <div class="controls"><button data-packing-sweep disabled>Run packing sweep</button>
        <button data-packing-cancel disabled>Cancel packing sweep</button></div>
      <p data-packing-progress>No packing sweep run.</p><div data-packing-results></div>
      <h3>Dynamic images and atlas replacement</h3><p>72 rows check nine ordered updates with nearest/linear sampling and four profiles.
        Same-size uploads, repacking, removal, empty atlases and restoration use the existing full-frame gates.</p>
      <div class="controls"><button data-dynamic-sweep disabled>Run image-update sweep</button>
        <button data-dynamic-cancel disabled>Cancel image-update sweep</button></div>
      <p data-dynamic-progress>No image-update sweep run.</p><div data-dynamic-results></div>
      <h3>Image decoding and color handling</h3><p>${DECODING_ROW_COUNT} rows compare seven decode/upload paths, nearest/linear and four profiles.
        Encoded PNGs include sRGB, linear-sRGB and Display-P3 color tags, alpha ramps and asymmetric rows.</p>
      <div class="controls"><button data-decoding-sweep disabled>Run decoding sweep</button>
        <button data-decoding-cancel disabled>Cancel decoding sweep</button></div>
      <p data-decoding-progress>No decoding sweep run.</p><div data-decoding-results></div></section>`
    : ''}
    ${caseId === 'effects'
    ? `<section data-run-part="diagnostics">
      <h3>Point rings and greyout</h3><p>${EFFECTS_ROW_COUNT} rows compare outline, hover and focus rings, greyout overrides and highlighted draw order.
        Exact polygon boundary cases remain in the gate; decorative overlays must never change IDs.</p>
      <div class="controls"><button data-effects-sweep disabled>Run rings and greyout sweep</button>
        <button data-effects-cancel disabled>Cancel rings sweep</button></div>
      <p data-effects-progress>No rings and greyout sweep run.</p><div data-effects-results></div></section>`
    : ''}
    <p class="demo-note" data-run-part="explanation" data-case-explanation></p>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  initializeStylingCase(host, caseId)
  el('[data-case-explanation]').textContent = {
    picking: 'The pixel readout uses a captured ID image. It does not measure production hover latency.',
    images: 'The CPU reference checks sampled image colors and picking masks; production compatibility is reported separately.',
    effects: 'The selected scene checks ring and greyout colors and picking masks. Decorative rings must not change IDs.',
  }[caseId]
  const status = el('[role="status"]'); const exportButton = el<HTMLButtonElement>('[data-export]')
  const inspectCenter = host.querySelector<HTMLButtonElement>('[data-inspect-center]')
  const setSweepDisabled = (disabled: boolean): void => {
    host.querySelectorAll<HTMLButtonElement>('[data-tiny-sweep], [data-atlas-sweep], [data-isolation-sweep], [data-packing-sweep]')
      .forEach(b => { b.disabled = disabled || dynamicActive || decodingActive })
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-decoding-sweep], [data-stored-alpha], [data-stored-cost], [data-filtered-cost]')) {
      button.disabled = disabled
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-dynamic-sweep], [data-effects-sweep]')) {
      button.disabled = disabled || decodingActive || (button.hasAttribute('data-effects-sweep') && dynamicActive)
    }
    if (caseId === 'images') {
      el<HTMLButtonElement>('[data-image-next]').disabled = disabled || !dynamicActive || dynamicStep === DYNAMIC_STEPS.length - 1
      el<HTMLButtonElement>('[data-image-reset]').disabled = disabled || !dynamicActive
    }
  }
  const backends: Partial<Record<'webgl' | 'webgpu', Backend>> = {}
  let snapshots: Partial<Record<'webgl' | 'webgpu', Snapshot>> = {}
  const errors: Partial<Record<'webgl' | 'webgpu', string>> = {}
  let destroyed = false; let busy = false; let sweepRunning = false; let cancelSweep = false
  let dynamicActive = false; let dynamicStep = 0; let decodingActive = false
  let latestEffects: boolean | undefined
  let effectsStudy: { startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[];
    rows: EffectsRow[]; error?: string; } | undefined
  let effectsActive = false
  let latestDecoding: boolean | undefined
  const decodeCache = new Map<DecodePolicy, DecodedImages>()
  const getDecoded = async (policy: DecodePolicy): Promise<DecodedImages> => {
    const cached = decodeCache.get(policy); if (cached) return cached
    const source = await decodeImages(policy)
    if (destroyed) { source.close(); throw new Error('Image decoder view destroyed') }
    decodeCache.set(policy, source); return source
  }
  let decodingStudy: { startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[];
    rows: DecodingRow[]; error?: string; } | undefined
  let dynamicStudy: { startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[];
    rows: DynamicRow[]; error?: string; } | undefined
  const exportLayout = (layout: AtlasLayout | undefined): object | undefined => layout && ({
    ...layout,
    bytes: Array.from(layout.bytes),
    coords: Array.from(layout.coords),
    images: layout.images.map(image => ({ ...image, bytes: Array.from(image.bytes) })),
  })
  let latestComparison: boolean | undefined
  let latestCompatibility: boolean | undefined
  let latestContribution: boolean | undefined
  let latestColorPreservation: boolean | undefined
  let latestAtlasColors: boolean | undefined
  let latestIsolation: boolean | undefined
  let packingStudy: { startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[];
    rows: PackingRow[]; error?: string; } | undefined
  let isolationStudy: { startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[];
    rows: IsolationRow[]; error?: string; } | undefined
  let atlasStudy: { startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[];
    rows: AtlasRow[]; error?: string; } | undefined
  let tinyStudy: {
    startedAt: string; finishedAt?: string; status: string; browser: string; devices: string[]; rows: TinyAlphaRow[]; error?: string;
  } | undefined
  let storedStudy: { policy: string; startedAt: string; finishedAt?: string; status: string; error?: string;
    browser: string; region: { x: number; y: number; width: number; height: number }; rows: Array<StoredAlphaRow & { lane: string }>; } | undefined
  let storedCost: { startedAt: string; finishedAt?: string; status: string; browser: string; error?: string;
    policy: typeof STORED_ALPHA_COST_POLICY; rows: StoredAlphaCostRow[]; } | undefined
  let filteredCost: { startedAt: string; finishedAt?: string; status: string; browser: string; error?: string;
    policy: string; rows: FilteredAlphaCostRow[]; } | undefined
  let report: object | undefined
  const disposeBackends = (): void => {
    Object.values(backends).forEach(backend => backend.destroy()); decodeCache.forEach(source => source.close()); decodeCache.clear()
  }
  const restoreSelectControls = (): void => {
    host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = false })
    el<HTMLSelectElement>('[data-effects-scene]').disabled = !effectsActive
    el<HTMLSelectElement>('[data-effects-profile]').disabled = !effectsActive
    el<HTMLSelectElement>('[data-overlay-arithmetic]').disabled = !effectsActive || el<HTMLSelectElement>('[data-renderer]').value === 'production'
    el<HTMLSelectElement>('[data-polygon-arithmetic]').disabled = !effectsActive || el<HTMLSelectElement>('[data-renderer]').value === 'production'
    el<HTMLSelectElement>('[data-decode-policy]').disabled = !decodingActive || el<HTMLSelectElement>('[data-renderer]').value === 'production'
    el<HTMLSelectElement>('[data-atlas-packing]').disabled = dynamicActive || decodingActive
    for (const option of el<HTMLSelectElement>('[data-atlas-isolation]').options) {
      option.disabled = (dynamicActive || decodingActive) && !['original', 'clamp', 'texel'].includes(option.value)
    }
  }
  const inspector = mountPixelInspector(host, false, lane => snapshots[lane], () => !busy && !destroyed)
  const render = async (): Promise<void> => {
    if (busy || sweepRunning || destroyed) return
    busy = true; snapshots = {}; report = undefined; latestComparison = undefined; latestCompatibility = undefined; latestContribution = undefined
    latestColorPreservation = undefined; latestEffects = undefined
    latestAtlasColors = undefined; latestIsolation = undefined; latestDecoding = undefined
    runError = undefined; exportButton.disabled = true
    if (inspectCenter) inspectCenter.disabled = true
    setSweepDisabled(true)
    inspector.reset()
    host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
    status.textContent = 'Drawing and checking every framebuffer pixel…'
    const name = el<HTMLSelectElement>('[data-fixture]').value as Parameters<typeof fixture>[0] | 'atlas-dynamic' | 'atlas-decoding' | 'point-effects'
    const isDynamic = name === 'atlas-dynamic'; const isDecoding = name === 'atlas-decoding'
    const isEffects = name === 'point-effects'
    if (isEffects && !effectsActive) {
      el<HTMLSelectElement>('[data-renderer]').value = 'eligibility'
      el<HTMLSelectElement>('[data-atlas-isolation]').value = 'texel'
    }
    effectsActive = isEffects
    if (!isDynamic && dynamicActive) { Object.values(backends).forEach(backend => backend.atlas.replace()); dynamicActive = false }
    if (!isDecoding && decodingActive) { Object.values(backends).forEach(backend => backend.atlas.replace()); decodingActive = false }
    if (isDynamic && !dynamicActive) {
      dynamicActive = true; dynamicStep = 0
      el<HTMLSelectElement>('[data-renderer]').value = 'eligibility'; el<HTMLSelectElement>('[data-atlas-isolation]').value = 'texel'
      Object.values(backends).forEach(backend => applyDynamicStep(backend.atlas, 0))
    }
    if (isDecoding && !decodingActive) {
      decodingActive = true
      el<HTMLSelectElement>('[data-renderer]').value = 'eligibility'; el<HTMLSelectElement>('[data-atlas-isolation]').value = 'texel'
      el<HTMLSelectElement>('[data-decode-policy]').value = 'normalized-premultiplied'
    }
    const packingSelect = host.querySelector<HTMLSelectElement>('[data-atlas-packing]')
    if (packingSelect) {
      if (isDynamic || isDecoding || (name.startsWith('atlas-packing-') && packingSelect.value === 'baseline')) packingSelect.value = 'npot-square'
      packingSelect.options[0].disabled = name.startsWith('atlas-packing-')
    }
    let settings: Settings = {
      ...DEFAULTS,
      overlayArithmetic: isEffects && el<HTMLSelectElement>('[data-overlay-arithmetic]').value === 'pixels' ? 'pixels' : undefined,
      polygonArithmetic: isEffects && el<HTMLSelectElement>('[data-polygon-arithmetic]').value === 'pixels' ? 'pixels' : undefined,
      zoom: Number(el<HTMLSelectElement>('[data-zoom]').value),
      ratio: Number(el<HTMLSelectElement>('[data-ratio]').value),
      opacity: Number(el<HTMLSelectElement>('[data-opacity]').value),
      scaleOnZoom: el<HTMLSelectElement>('[data-scale]').value === 'yes',
      reverse: el<HTMLSelectElement>('[data-order]').value === 'reverse',
      imageFilter: el<HTMLSelectElement>('[data-image-filter]').value as 'nearest' | 'linear',
      atlasIsolation: el<HTMLSelectElement>('[data-atlas-isolation]').value as NonNullable<Settings['atlasIsolation']>,
      atlasPacking: packingSelect!.value as NonNullable<Settings['atlasPacking']>,
    }
    const scenario = isEffects
      ? effectScenario(el<HTMLSelectElement>('[data-effects-scene]').value as EffectsFixture,
        Number(el<HTMLSelectElement>('[data-effects-profile]').value), settings)
      : undefined
    if (scenario) {
      settings = scenario.settings
      el<HTMLSelectElement>('[data-opacity]').value = String(settings.opacity)
    }
    const points = scenario ? scenario.points : isDynamic ? dynamicPoints() : isDecoding ? decodingPoints() : fixture(name as Parameters<typeof fixture>[0])
    const variant = el<HTMLSelectElement>('[data-renderer]').value as RenderVariant
    const decodePolicy = isDecoding ? el<HTMLSelectElement>('[data-decode-policy]').value as DecodePolicy : 'production'
    let selectedDecode: DecodedImages | undefined; let decodedAudit: ReturnType<typeof auditDecoded> | undefined
    const canonical: Partial<Record<'webgl' | 'webgpu', Snapshot>> = {}
    const candidateLabel = variant === 'eligibility' ? 'Source-byte' : variant === 'quantized' ? 'Quantized' : 'Explicit'
    const isAtlas = name.startsWith('atlas-')
    const original: Partial<Record<'webgl' | 'webgpu', Snapshot>> = {}
    const unmodified: Partial<Record<'webgl' | 'webgpu', Snapshot>> = {}
    const polygonReplay = isEffects && el<HTMLSelectElement>('[data-effects-scene]').value === 'shapes'
    el('[data-legend]').textContent = isEffects
      ? 'Outline rings are part of the body fragment; hover/focus rings draw later. Greyed points draw first. ' +
        'Greyout opacity replaces global body opacity. Rings never add a pickable contour.'
      : isDecoding
        ? 'Four PNG profiles share asymmetric pixels and alpha ramps. Compare normalized bytes and direct uploads; source and render gates stay separate.'
        : isDynamic
          ? 'Seven point IDs show holes, an underlying shape and an initially absent image. Step through atlas changes; production sampling stays unchanged.'
          : name.startsWith('atlas-packing-')
            ? 'Five non-square sources include a one-texel-wide faint image and rectangular UV spans. Image footprints follow production’s square sizing.'
            : isAtlas
              ? name === 'atlas-images'
                ? 'Four atlas tiles: asymmetric opaque/transparent image, opaque contrast, invisible RGB, faint alpha 1/255.'
                : name === 'atlas-shapes'
                  ? 'The same image is smaller and larger than its point shape. Transparent texels may reveal the same point’s shape.'
                  : name === 'atlas-overlap'
                    ? 'A textured foreground over a visible background point. Holes must not steal the background ID; reverse the order to compare.'
                    : 'Fractional sizes/positions and exact UV edges. Production atlas rectangles are retained, including potential neighbor sampling.'
              : name === 'shapes'
                ? 'Circle · square · triangle · diamond · pentagon · hexagon · star · cross. ' +
                'The bottom row adds an inset stroke. Both crosses have 40% fill opacity.'
                : name === 'edge-cases'
                  ? 'Top: defaults · zero size · transparent · None · absent · size cap. Bottom: subpixel · capped stroke · translucent.'
                  : name === 'tiny-alpha'
                    ? 'Columns: 1/64, 1/8, 1/2, 2 and 42 CSS px. Rows: fill alpha 1, 1/255 and 1/65536. Tiny source ink may quantize to zero.'
                    : name === 'tiny-overlap'
                      ? 'Opaque blue background point and faint warm foreground point (fill alpha 1/65536). The foreground is also checked in isolation.'
                      : name === 'alpha-stack'
                        ? '64 overlapping white circles, each at fill alpha 0.51/255. Compare production color compatibility as well as candidate visibility.'
                        : 'Three overlapping shapes; reverse the order to change the topmost ID without changing point identity.'
    if (isEffects) {
      const arithmetic = variant === 'production' ? 'normalized production' : settings.polygonArithmetic ?? 'normalized control'
      el('[data-legend]').textContent += ` Polygon arithmetic: ${arithmetic}. The CPU mask is unchanged. Hover/focus distance: ${
        variant !== 'production' && settings.overlayArithmetic === 'pixels' ? 'pixel-distance candidate' : 'interpolated control'}.`
    }
    if (isAtlas) {
      el('[data-legend]').textContent += ` Candidate sampling policy: ${settings.atlasIsolation
      }; production retains original UVs. Pick-only color preservation uses the same sampling policy in both draws.`
    }
    if (isAtlas && settings.atlasIsolation === 'texel') {
      el('[data-legend]').textContent += ' Nearest samples use integer source texels; linear filtering retains the clamped sampler.'
    }
    if (isAtlas && !isDynamic && !isDecoding && settings.atlasPacking && settings.atlasPacking !== 'baseline') {
      const layout = packingLayout(settings.atlasPacking)
      el('[data-legend]').textContent += ` Atlas: ${layout.width} × ${layout.height}; ${layout.images.length} images, ` +
        `${layout.coordsSize} × ${layout.coordsSize} UV records.`
    }
    try {
      if (isDecoding) {
        const control = await getDecoded('production')
        selectedDecode = variant === 'production' ? control : await getDecoded(decodePolicy)
        decodedAudit = auditDecoded(selectedDecode, control)
        for (const lane of ['webgl', 'webgpu'] as const) {
          const backend = backends[lane]; if (!backend) continue
          installDecoded(backend, control)
          original[lane] = await backend.render(points, settings, false, 'production', false)
          canonical[lane] = await backend.render(points, settings, false, variant, false)
          installDecoded(backend, selectedDecode)
        }
      }
      for (const name of ['webgl', 'webgpu'] as const) {
        if (!backends[name]) continue
        try {
          if (variant !== 'production' && !isDecoding) original[name] = await backends[name]!.render(points, settings, false, 'production')
          if (variant === 'eligibility') unmodified[name] = await backends[name]!.render(points, settings, false, 'explicit', false)
          snapshots[name] = await backends[name]!.render(points, settings, polygonReplay, variant)
          if (destroyed) return
          delete errors[name]
          // Full device details stay in Live results and the exported report.
          el(`[data-device="${name}"]`).textContent = ''
          el(`[data-state="${name}"]`).textContent = 'Rendered'
          const heading = el(`[data-canvas="${name}"]`).closest('.backend-panel')!.querySelector('h2')!
          heading.textContent = variant !== 'production'
            ? `${candidateLabel} ${name === 'webgl' ? 'WebGL' : 'WebGPU'} quads`
            : name === 'webgl' ? 'Cosmos WebGL' : 'luma WebGPU'
        } catch (error) {
          runError = String(error)
          errors[name] = String(error); el(`[data-state="${name}"]`).textContent = 'Failed'
          el(`[data-device="${name}"]`).textContent = String(error)
        }
      }
      if (destroyed) return
      const checkForeground = name === 'tiny-overlap' || name === 'atlas-overlap' || name === 'atlas-packing-overlap' || isDynamic || isDecoding
      const contribution = checkForeground && snapshots.webgl && snapshots.webgpu
        ? await inspectForeground({ webgl: backends.webgl!, webgpu: backends.webgpu! },
          { webgl: snapshots.webgl, webgpu: snapshots.webgpu }, points, settings, variant)
        : undefined
      if (destroyed) return
      const comparison = snapshots.webgl && snapshots.webgpu ? await compareSnapshotsAsync(snapshots.webgl, snapshots.webgpu, points, settings) : undefined
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
      const colorPreservation = unmodified.webgl && unmodified.webgpu && snapshots.webgl && snapshots.webgpu
        ? { webgl: compareColors(unmodified.webgl, snapshots.webgl), webgpu: compareColors(unmodified.webgpu, snapshots.webgpu) }
        : undefined
      latestColorPreservation = colorPreservation
        ? colorPreservation.webgl.changedPixels === 0 && colorPreservation.webgpu.changedPixels === 0
        : undefined
      const cpuAtlasColors = isAtlas && snapshots.webgl && snapshots.webgpu
        ? { webgl: atlasCpuColors(snapshots.webgl, points, settings), webgpu: atlasCpuColors(snapshots.webgpu, points, settings) }
        : undefined
      const effectColors = isEffects && snapshots.webgl && snapshots.webgpu
        ? { webgl: effectsCpuColors(snapshots.webgl, points, settings), webgpu: effectsCpuColors(snapshots.webgpu, points, settings) }
        : undefined
      latestEffects = effectColors ? effectColors.webgl.budgetFailures === 0 && effectColors.webgpu.budgetFailures === 0 : undefined
      latestAtlasColors = cpuAtlasColors ? cpuAtlasColors.webgl.budgetFailures === 0 && cpuAtlasColors.webgpu.budgetFailures === 0 : undefined
      const isolatedAtlas = isAtlas && snapshots.webgl && snapshots.webgpu
        ? await inspectAtlasIsolation({ webgl: snapshots.webgl, webgpu: snapshots.webgpu }, points, settings)
        : undefined
      if (destroyed) return
      latestIsolation = isolatedAtlas?.valid
      const canonicalComparison = canonical.webgl && snapshots.webgpu
        ? await compareSnapshotsAsync(canonical.webgl, snapshots.webgpu, points, settings)
        : undefined
      const canonicalColors = canonical.webgl && canonical.webgpu && snapshots.webgl && snapshots.webgpu
        ? { webgl: compareColors(canonical.webgl, snapshots.webgl), webgpu: compareColors(canonical.webgpu, snapshots.webgpu) }
        : undefined
      const canonicalIds = isDecoding
        ? (['webgl', 'webgpu'] as const).every(lane =>
          canonical[lane]?.ids.every((value, index) => value === snapshots[lane]?.ids[index]))
        : undefined
      latestDecoding = decodedAudit && canonicalColors
        ? decodedAudit.every(row => row.valid) && canonicalIds === true &&
          canonicalColors.webgl.budgetFailures === 0 && canonicalColors.webgpu.budgetFailures === 0
        : undefined
      const polygonAudit = polygonReplay && snapshots.webgl && snapshots.webgpu
        ? auditPolygons(snapshots.webgl, snapshots.webgpu, points, settings)
        : undefined
      report = {
        polygonAudit,
        schemaVersion: 17,
        effects: scenario && {
          scene: el<HTMLSelectElement>('[data-effects-scene]').value,
          profile: EFFECTS_PROFILES[Number(el<HTMLSelectElement>('[data-effects-profile]').value)].name,
          cpuColors: effectColors,
          overlayArithmetic: { webgl: snapshots.webgl?.overlayArithmetic, webgpu: snapshots.webgpu?.overlayArithmetic },
        },
        decoding: selectedDecode && {
          requested: decodePolicy,
          actual: selectedDecode.policy,
          sourceAudit: decodedAudit,
          options: DECODE_POLICIES.find(p => p.id === selectedDecode!.policy),
          encodedPngs: selectedDecode.encoded,
          normalizedImages: selectedDecode.images.map(image => ({ ...image, bytes: Array.from(image.bytes) })),
          canonicalComparison,
          canonicalColors,
        },
        dynamicAtlas: isDynamic
          ? {
            step: dynamicStep,
            name: DYNAMIC_STEPS[dynamicStep].name,
            generation: snapshots.webgl?.atlasGeneration,
            source: exportLayout(backends.webgl?.atlas.layout),
          }
          : undefined,
        experiment,
        isolatedImageReference: 'source-texel-v2; baseline and production-normalized controls retained',
        sourceTexelAddressing: variant !== 'production' && settings.atlasIsolation === 'texel'
          ? {
            nearest: 'pixel offset → source-texel numerator / image diameter → integer floor/clamp → unfiltered texel fetch',
            linear: 'unchanged tile-clamped hardware sampling',
            rectangles: snapshots.webgl?.atlasSource?.rects ?? Array.from(sourceTexelRects(settings.atlasPacking)),
          }
          : undefined,
        recordedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        validationContract: pointStylingExportContract,
        fixture: name,
        renderer: variant,
        sourceAlphaPolicy: variant === 'eligibility'
          ? (isEffects ? { ...SOURCE_BYTE_PICKING_POLICY, ...EFFECTS_SOURCE_ALPHA } : isAtlas ? ATLAS_PICKING_POLICY : SOURCE_BYTE_PICKING_POLICY)
          : variant === 'quantized'
            ? (isEffects ? { ...SOURCE_ALPHA_POLICY, ...EFFECTS_SOURCE_ALPHA } : isAtlas ? ATLAS_QUANTIZED_POLICY : SOURCE_ALPHA_POLICY)
            : undefined,
        colorPreservation,
        atlas: isAtlas
          ? snapshots.webgl?.atlasSource
            ? exportLayout(snapshots.webgl.atlasSource)
            : settings.atlasPacking === 'baseline'
              ? ATLAS_EXPORT
              : packingExport(settings.atlasPacking ?? 'npot-square', variant !== 'production' && settings.atlasIsolation === 'gutter')
          : undefined,
        cpuAtlasColors,
        isolatedAtlas,
        atlasIsolation: isAtlas
          ? {
            requested: settings.atlasIsolation,
            webgl: snapshots.webgl?.atlasIsolation,
            webgpu: snapshots.webgpu?.atlasIsolation,
            baselineDefinitions: ATLAS_ISOLATION_EXPORT,
          }
          : undefined,
        points,
        settings,
        colorBudget: COLOR_BUDGET,
        devices: Object.fromEntries(Object.entries(backends).map(([name, backend]) => [name, backend.info])),
        errors: { ...errors },
        comparison,
        analyticControl,
        productionComparison,
        compatibility,
        contribution,
      }
      const output = el('[data-results]')
      if (comparison) {
        output.innerHTML = `<h3>Framebuffer audit</h3>
          <p data-picking-rule>CPU rule: ${comparison.pickingRules.webgl === 'source-alpha'
    ? variant === 'eligibility'
      ? 'source-alpha — nonzero source byte gates picking; color retains the original alpha and blending.'
      : 'source-alpha — shape/image coverage intersected with a nonzero source byte; color and picking share quantized alpha.'
    : comparison.pickingRules.webgl === 'visible'
      ? 'visible — global opacity zero returns background; positive opacity retains the half-coverage contour.'
      : 'legacy — global opacity does not change picking.'}</p><table><tbody>
          <tr><th>Result</th><td>${checkResult(comparison.valid)}</td></tr>
          <tr><th>Pixels checked</th><td>${formatCount(comparison.pixels)}</td></tr>
          <tr><th>WebGL ↔ WebGPU ID differences</th><td>${formatCount(comparison.idDisagreements)}</td></tr>
          <tr><th>Scalar mask differences · WebGL / WebGPU</th>
            <td>${formatCount(comparison.webglReferenceFailures)} / ${formatCount(comparison.webgpuReferenceFailures)}</td></tr>
          <tr><th>RGBA pixels beyond ${COLOR_BUDGET}/255 channel budget</th>
            <td>${formatCount(comparison.colorFailures)} · max ${comparison.maxChannelError}/255</td></tr>
          <tr><th>Painted pixels · WebGL / WebGPU</th>
            <td>${formatCount(comparison.webglPaintedPixels)} / ${formatCount(comparison.webgpuPaintedPixels)}</td></tr>
          <tr><th>Picked pixels · WebGL / WebGPU</th>
            <td>${formatCount(comparison.webglPickedPixels)} / ${formatCount(comparison.webgpuPickedPixels)}</td></tr>
          <tr><th>Picked pixels with zero rendered alpha · WebGL / WebGPU</th>
            <td>${formatCount(comparison.webglInvisiblePicks)} / ${formatCount(comparison.webgpuInvisiblePicks)}</td></tr>
          </tbody></table>`
        if (colorPreservation) {
          output.insertAdjacentHTML('beforeend', `<h3>Original color output</h3>
            <p>Byte comparison with the unquantized explicit-coordinate control in each API, using the same atlas sampling policy.
            This checks color independently of the changed picking rule.</p>
            <table data-color-preservation><thead><tr><th>Backend</th><th>Changed color pixels</th>
              <th>Maximum channel difference</th><th>Unchanged</th></tr></thead>
            <tbody>${(['webgl', 'webgpu'] as const).map(lane => `<tr><td>${lane}</td><td>${colorPreservation[lane].changedPixels}</td>
              <td>${colorPreservation[lane].maxChannelError}/255</td><td>${checkResult(colorPreservation[lane].changedPixels === 0)}</td></tr>`)
    .join('')}</tbody></table>`)
        }
        if (polygonAudit) renderPolygonAudit(output, polygonAudit)
        if (effectColors) {
          output.insertAdjacentHTML('beforeend', `<h3>CPU ring and greyout colors</h3>
            <p>Independent scalar composition, including image tint, inset strokes and ordered hover/focus overlays. Same 2/255 budget.</p>
            <table data-effects-cpu><thead><tr><th>Backend</th><th>Pixels beyond 2/255</th><th>Maximum difference</th><th>Result</th></tr></thead><tbody>
            ${(['webgl', 'webgpu'] as const).map(lane => `<tr><td>${lane}</td><td>${effectColors[lane].budgetFailures}</td>
              <td>${effectColors[lane].maxChannelError}/255</td><td>${checkResult(effectColors[lane].budgetFailures === 0)}</td></tr>`).join('')}
            </tbody></table>`)
        }
        if (cpuAtlasColors) {
          output.insertAdjacentHTML('beforeend', `<h3>CPU atlas color reference</h3>
            <p>Independent CPU sampling and production color composition; the same 2/255 budget applies to every pixel.</p>
            <table data-atlas-cpu><thead><tr><th>Backend</th><th>Pixels beyond 2/255</th><th>Maximum difference</th><th>Result</th></tr></thead>
            <tbody>${(['webgl', 'webgpu'] as const).map(lane => `<tr><td>${lane}</td><td>${cpuAtlasColors[lane].budgetFailures}</td>
              <td>${cpuAtlasColors[lane].maxChannelError}/255</td><td>${checkResult(cpuAtlasColors[lane].budgetFailures === 0)}</td></tr>`)
    .join('')}</tbody></table>`)
        }
        if (isolatedAtlas) {
          const m = isolatedAtlas.masks
          output.insertAdjacentHTML('beforeend', `<h3>Atlas tile isolation</h3>
            <p>Independent CPU images clamp to their own edges. Paired-policy agreement and production compatibility remain separate.</p>
            <table data-isolation-audit><tbody><tr><th>Actual sampling policy · WebGL / WebGPU</th>
              <td>${snapshots.webgl?.atlasIsolation} / ${snapshots.webgpu?.atlasIsolation}</td></tr>
              <tr><th>Isolated-image result</th><td>${checkResult(isolatedAtlas.valid)}</td></tr>
              <tr><th>Isolated CPU mask differences · WebGL / WebGPU</th><td>${m.webglReferenceFailures} / ${m.webgpuReferenceFailures}</td></tr>
              <tr><th>Isolated CPU color pixels beyond 2/255 · WebGL / WebGPU</th>
                <td>${isolatedAtlas.colors.webgl.budgetFailures} / ${isolatedAtlas.colors.webgpu.budgetFailures}</td></tr>
            </tbody></table>`)
        }
        if (contribution) renderContributionAudit(output, contribution)
        if (productionComparison && compatibility) {
          renderExplicitControl(output, { production: productionComparison, compatibility }, variant)
        }
        if (decodedAudit && selectedDecode) {
          const section = document.createElement('section'); output.append(section)
          renderDecodeAudit(section, decodedAudit, selectedDecode.policy)
          section.insertAdjacentHTML('beforeend', `<h3>Normalized input preserved</h3>
            <p>Compare the same candidate geometry with the production-decoded pixels. This is separate from legacy shader compatibility.</p>
            <table data-decoded-colors><thead><tr><th>Backend</th><th>Pixels beyond 2/255</th><th>Maximum channel error</th></tr></thead><tbody>
            ${(['webgl', 'webgpu'] as const).map(lane => `<tr><td>${lane}</td><td>${canonicalColors?.[lane].budgetFailures}</td>
              <td>${canonicalColors?.[lane].maxChannelError}/255</td></tr>`).join('')}</tbody></table>`)
        }
        status.textContent = comparison.valid
          ? variant !== 'production'
            ? `${candidateLabel} candidate passed. ` +
              `Production compatibility ${compatibility?.valid ? 'passed' : 'differs; see the control below'}.`
            : 'Passed: exact IDs and shape masks; colors within the declared budget; no invisible picks.'
          : variant === 'production' && settings.opacity === 0
            ? 'Failed visibility control: production host picking still selects points at global opacity zero. Both paths retain this discrepancy.'
            : 'Differences found. Inspect the counts and export the frozen inputs; this configuration is not accepted.'
        if ((variant === 'quantized' || variant === 'eligibility') && comparison.valid && compatibility && compatibility.colorFailures > 0) {
          status.textContent = `${candidateLabel} frame passed. Production color compatibility failed at ${formatCount(compatibility.colorFailures)} pixels: ` +
            `max ${compatibility.maxChannelError}/255, budget ${COLOR_BUDGET}/255.`
        }
        if (latestColorPreservation === false) status.textContent = 'Failed color-preservation check: this candidate changed the original color image.'
        if (latestIsolation === false) status.textContent += ' Tile isolation failed; see the independent image reference.'
        if (latestAtlasColors === false) status.textContent = 'Failed CPU atlas color check. Inspect the full-image counts and export the first rejected pixel.'
        if (latestContribution === false) {
          status.textContent = 'Failed contribution check: the selected foreground paints zero alpha by itself. ' +
          'Background paint does not make it visible.'
        }
      } else {
        output.textContent = 'Incomplete comparison. Both backends must render before a verdict is available.'
        status.textContent = 'Incomplete: see backend errors.'
      }
      if (latestEffects === false) status.textContent += ' CPU ring/greyout color check failed.'
      if (latestDecoding === false) status.textContent += ' Decoded source/input color check failed; see the source audit.'
      if (isDynamic) {
        const layout = backends.webgl?.atlas.layout
        const label = `Update ${dynamicStep + 1}/${DYNAMIC_STEPS.length} · ${DYNAMIC_STEPS[dynamicStep].name}`
        el('[data-image-stage]').textContent = `${label} · ${
          layout ? `${layout.images.length} images / ${layout.width} × ${layout.height}` : 'static control restored'}`
        status.textContent = `${label}. ${status.textContent}`
      } else if (isDecoding) {
        const selected = DECODE_POLICIES.find(p => p.id === selectedDecode?.policy)
        el('[data-image-stage]').textContent = `${selected?.name ?? 'Decoding PNGs'} · ${selected?.external
          ? 'Bitmap uploaded directly; normalized ImageData supplies the CPU reference.'
          : 'Atlas receives straight-alpha sRGB ImageData bytes.'}`
      }
      exportButton.disabled = false
      setSweepDisabled(!backends.webgl || !backends.webgpu)
    } finally {
      busy = false
      if (destroyed) disposeBackends()
      else {
        if (inspectCenter) inspectCenter.disabled = !Object.keys(snapshots).length
        inspector.restore()
        restoreSelectControls()
      }
    }
  }
  const redraw = (): void => {
    refreshStylingCase(host, caseId)
    render().catch(error => { runError = String(error); status.textContent = runError })
  }
  host.querySelectorAll<HTMLSelectElement>('select').forEach(c => c.addEventListener('change', redraw))
  host.querySelector('[data-image-next]')?.addEventListener('click', () => {
    if (busy || sweepRunning || !dynamicActive || dynamicStep >= DYNAMIC_STEPS.length - 1) return
    dynamicStep++; Object.values(backends).forEach(backend => applyDynamicStep(backend.atlas, dynamicStep))
    render().catch(error => { runError = String(error); status.textContent = runError })
  })
  host.querySelector('[data-image-reset]')?.addEventListener('click', () => {
    if (busy || sweepRunning || !dynamicActive) return
    dynamicStep = 0; Object.values(backends).forEach(backend => applyDynamicStep(backend.atlas, 0))
    render().catch(error => { runError = String(error); status.textContent = runError })
  })
  exportButton.addEventListener('click', () => {
    if (!report || busy || sweepRunning) return
    const json = JSON.stringify({
      ...report,
      storedAlphaReplay: storedStudy,
      storedAlphaCost: storedCost,
      filteredStoredAlphaCost: filteredCost,
      effectsSweep: effectsStudy && {
        ...effectsStudy,
        inputs: {
          defaults: DEFAULTS,
          profiles: EFFECTS_PROFILES,
          views: EFFECTS_VIEWS,
          fixtures: EFFECTS_FIXTURES,
          sourceAlpha: EFFECTS_SOURCE_ALPHA,
          reference: 'scalar body masks + scalar source-over rings; production shaders unchanged',
        },
      },
      tinyAlphaSweep: tinyStudy && {
        ...tinyStudy,
        inputs: {
          defaults: DEFAULTS,
          sourceAlphaPolicy: SOURCE_ALPHA_POLICY,
          sourceBytePickingPolicy: SOURCE_BYTE_PICKING_POLICY,
          opacities: TINY_OPACITIES,
          ratios: [1, 2],
          fixtures: [{ name: 'tiny-alpha', points: fixture('tiny-alpha') }, { name: 'tiny-overlap', points: fixture('tiny-overlap') }],
        },
      },
      decodingSweep: decodingStudy && {
        ...decodingStudy,
        inputs: {
          points: decodingPoints(),
          defaults: DEFAULTS,
          profiles: DECODING_PROFILES,
          policies: DECODE_POLICIES,
          filters: ['nearest', 'linear'],
          spaces: DECODE_SPACES,
          encodedPixels: Array.from(DECODE_PIXELS),
          encodedPngs: decodeCache.get('production')?.encoded,
          reference: 'Production image + default canvas ImageData; ICC opaque-color math; immutable source-texel-v2 GPU reference',
        },
      },
      dynamicSweep: dynamicStudy && {
        ...dynamicStudy,
        inputs: {
          points: dynamicPoints(),
          defaults: DEFAULTS,
          profiles: DYNAMIC_PROFILES,
          filters: ['nearest', 'linear'],
          reference: 'source-texel-v2; immutable requested image generation',
          steps: DYNAMIC_STEPS.map(step => ({
            ...step,
            ...('images' in step ? { images: step.images.map(image => ({ ...image, bytes: Array.from(image.bytes) })) } : {}),
            ...('image' in step ? { image: { ...step.image, bytes: Array.from(step.image.bytes) } } : {}),
          })),
        },
      },
      packingSweep: packingStudy && {
        ...packingStudy,
        inputs: {
          reference: 'source-texel-v2',
          defaults: DEFAULTS,
          layouts: PACKING_NAMES.map(name => packingExport(name)),
          profiles: PACKING_PROFILES,
          filters: ['nearest', 'linear'],
          policies: PACKING_POLICIES,
          fixtures: PACKING_FIXTURES.map(name => ({ name, points: fixture(name) })),
        },
      },
      isolationSweep: isolationStudy && {
        ...isolationStudy,
        inputs: {
          defaults: DEFAULTS,
          definitions: ATLAS_ISOLATION_EXPORT,
          profiles: ATLAS_PROFILES,
          filters: ['nearest', 'linear'],
          fixtures: ATLAS_FIXTURES.map(name => ({ name, points: fixture(name) })),
        },
      },
      atlasSweep: atlasStudy && {
        ...atlasStudy,
        inputs: {
          defaults: DEFAULTS,
          atlas: ATLAS_EXPORT,
          policy: ATLAS_PICKING_POLICY,
          profiles: ATLAS_PROFILES,
          filters: ['nearest', 'linear'],
          fixtures: ATLAS_FIXTURES.map(name => ({ name, points: fixture(name) })),
        },
      },
    },
    (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a')
    link.href = url; link.download = `cosmos-${experiment}.json`; link.click(); URL.revokeObjectURL(url)
  })
  host.querySelector('[data-tiny-cancel]')?.addEventListener('click', () => { cancelSweep = true })
  host.querySelector('[data-tiny-sweep]')?.addEventListener('click', () => {
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
      setSweepDisabled(true)
      el('[data-tiny-results]').replaceChildren()
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      el<HTMLButtonElement>('[data-tiny-cancel]').disabled = false
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
        if (destroyed) disposeBackends()
        else {
          restoreSelectControls()
          exportButton.disabled = !report; setSweepDisabled(false)
          el<HTMLButtonElement>('[data-tiny-cancel]').disabled = true
          el('[data-tiny-progress]').textContent = `${study.status} · ${study.rows.length} / 32 rows · ` +
            `${study.rows.filter(row => !row.candidateAccepted).length} explicit / ` +
            `${study.rows.filter(row => !row.quantizedAccepted).length} quantized / ` +
            `${study.rows.filter(row => !row.eligibilityAccepted).length} source-byte rows rejected. Export JSON retains every count and first failure.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error) })
  })
  host.querySelector('[data-atlas-cancel]')?.addEventListener('click', () => { cancelSweep = true })
  host.querySelector('[data-atlas-sweep]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const runSweep = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false
      const study = {
        startedAt: new Date().toISOString(),
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as AtlasRow[],
        finishedAt: undefined as string | undefined,
        error: undefined as string | undefined,
      }
      atlasStudy = study; exportButton.disabled = true; el('[data-atlas-results]').replaceChildren()
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      setSweepDisabled(true)
      el<HTMLButtonElement>('[data-atlas-cancel]').disabled = false
      el('[data-atlas-progress]').textContent = 'Starting 40 full-frame cases…'
      try {
        await runAtlasSweep({ webgl: backends.webgl!, webgpu: backends.webgpu! }, row => {
          study.rows.push(row)
          if (destroyed) return
          renderAtlasRows(el('[data-atlas-results]'), study.rows)
          el('[data-atlas-progress]').textContent = `${study.rows.length} / 40 · ${row.fixture} · ${row.filter} · ${row.profile}`
        }, () => cancelSweep || destroyed)
        study.status = cancelSweep || destroyed ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error); runError = study.error } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          restoreSelectControls()
          exportButton.disabled = !report; setSweepDisabled(false); el<HTMLButtonElement>('[data-atlas-cancel]').disabled = true
          el('[data-atlas-progress]').textContent = `${study.status} · ${study.rows.length} / 40 · ` +
            `${study.rows.filter(row => !row.accepted).length} source-byte cases rejected. Export retains all counts and first failures.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error) })
  })
  host.querySelector('[data-isolation-cancel]')?.addEventListener('click', () => { cancelSweep = true })
  host.querySelector('[data-isolation-sweep]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const runSweep = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false
      const study = {
        startedAt: new Date().toISOString(),
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as IsolationRow[],
        finishedAt: undefined as string | undefined,
        error: undefined as string | undefined,
      }
      isolationStudy = study; exportButton.disabled = true; el('[data-isolation-results]').replaceChildren()
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      setSweepDisabled(true); el<HTMLButtonElement>('[data-isolation-cancel]').disabled = false
      el('[data-isolation-progress]').textContent = 'Starting 160 full-frame policy rows…'
      try {
        await runIsolationSweep({ webgl: backends.webgl!, webgpu: backends.webgpu! }, row => {
          study.rows.push(row)
          if (destroyed) return
          renderIsolationRows(el('[data-isolation-results]'), study.rows)
          el('[data-isolation-progress]').textContent = `${study.rows.length} / 160 · ${row.fixture} · ${row.filter} · ${row.profile} · ${row.policy}`
        }, () => cancelSweep || destroyed)
        study.status = cancelSweep || destroyed ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error); runError = study.error } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          restoreSelectControls()
          exportButton.disabled = !report; setSweepDisabled(false); el<HTMLButtonElement>('[data-isolation-cancel]').disabled = true
          el('[data-isolation-progress]').textContent = `${study.status} · ${study.rows.length} / 160 · ` +
            `${study.rows.filter(row => !row.isolatedPass).length} isolated-image rows rejected. All policies and compatibility failures retained.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error) })
  })
  host.querySelector('[data-packing-cancel]')?.addEventListener('click', () => { cancelSweep = true })
  host.querySelector('[data-packing-sweep]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const runSweep = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false
      const study = {
        startedAt: new Date().toISOString(),
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as PackingRow[],
        finishedAt: undefined as string | undefined,
        error: undefined as string | undefined,
      }
      packingStudy = study; exportButton.disabled = true; el('[data-packing-results]').replaceChildren()
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      setSweepDisabled(true); el<HTMLButtonElement>('[data-packing-cancel]').disabled = false
      el('[data-packing-progress]').textContent = `Starting ${PACKING_ROW_COUNT} full-frame packing rows…`
      try {
        await runPackingSweep({ webgl: backends.webgl!, webgpu: backends.webgpu! }, row => {
          study.rows.push(row)
          if (destroyed) return
          renderPackingRows(el('[data-packing-results]'), study.rows)
          el('[data-packing-progress]').textContent = `${study.rows.length} / ${PACKING_ROW_COUNT} · ${row.packing} · ${row.fixture} · ` +
            `${row.filter} · ${row.profile} · ${row.policy}`
        }, () => cancelSweep || destroyed)
        study.status = cancelSweep || destroyed ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error); runError = study.error } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          restoreSelectControls()
          exportButton.disabled = !report; setSweepDisabled(false); el<HTMLButtonElement>('[data-packing-cancel]').disabled = true
          el('[data-packing-progress]').textContent = `${study.status} · ${study.rows.length} / ${PACKING_ROW_COUNT} · ` +
            `${study.rows.filter(row => !row.passed).length} isolated-image rows rejected. All controls and failed rows retained.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error) })
  })
  host.querySelector('[data-dynamic-cancel]')?.addEventListener('click', () => { if (sweepRunning) cancelSweep = true })
  host.querySelector('[data-dynamic-sweep]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const runSweep = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false; runError = undefined
      const study = {
        startedAt: new Date().toISOString(),
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(backend => backend.info),
        rows: [] as DynamicRow[],
        finishedAt: undefined as string | undefined,
        error: undefined as string | undefined,
      }
      dynamicStudy = study
      const previous = { webgl: backends.webgl!.atlas.layout, webgpu: backends.webgpu!.atlas.layout }
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      setSweepDisabled(true); exportButton.disabled = true; el<HTMLButtonElement>('[data-dynamic-cancel]').disabled = false
      el('[data-dynamic-results]').replaceChildren(); el('[data-dynamic-progress]').textContent = `Starting ${DYNAMIC_ROW_COUNT} image-update rows…`
      try {
        await runDynamicSweep({ webgl: backends.webgl!, webgpu: backends.webgpu! }, row => {
          study.rows.push(row)
          if (destroyed) return
          renderDynamicRows(el('[data-dynamic-results]'), study.rows)
          el('[data-dynamic-progress]').textContent = `${study.rows.length} / ${DYNAMIC_ROW_COUNT} · ${row.name} · ${row.profile} · ${row.filter}`
        }, () => cancelSweep || destroyed)
        study.status = cancelSweep || destroyed ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error); runError = study.error } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          for (const lane of ['webgl', 'webgpu'] as const) backends[lane]!.atlas.replace(previous[lane]?.images)
          restoreSelectControls()
          el<HTMLSelectElement>('[data-atlas-packing]').disabled = dynamicActive
          exportButton.disabled = !report; setSweepDisabled(false); el<HTMLButtonElement>('[data-dynamic-cancel]').disabled = true
          el('[data-dynamic-progress]').textContent = `${study.status} · ${study.rows.length} / ${DYNAMIC_ROW_COUNT} · ` +
            `${study.rows.filter(row => !row.passed).length} candidate rows rejected. Controls and failed rows retained; live image state restored.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error); status.textContent = runError })
  })
  host.querySelector('[data-decoding-cancel]')?.addEventListener('click', () => { if (sweepRunning) cancelSweep = true })
  host.querySelector('[data-decoding-sweep]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const runSweep = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false; runError = undefined
      const study = {
        startedAt: new Date().toISOString(),
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(backend => backend.info),
        rows: [] as DecodingRow[],
        finishedAt: undefined as string | undefined,
        error: undefined as string | undefined,
      }
      decodingStudy = study
      const previous = { webgl: backends.webgl!.atlas.layout, webgpu: backends.webgpu!.atlas.layout }
      const selected = decodingActive
        ? decodeCache.get(el<HTMLSelectElement>('[data-renderer]').value === 'production'
          ? 'production'
          : el<HTMLSelectElement>('[data-decode-policy]').value as DecodePolicy)
        : undefined
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      setSweepDisabled(true); exportButton.disabled = true; el<HTMLButtonElement>('[data-decoding-cancel]').disabled = false
      el('[data-decoding-results]').replaceChildren(); el('[data-decoding-progress]').textContent = `Starting ${DECODING_ROW_COUNT} decode/upload rows…`
      try {
        await getDecoded('production')
        await runDecodingSweep({ webgl: backends.webgl!, webgpu: backends.webgpu! }, row => {
          study.rows.push(row)
          if (destroyed) return
          renderDecodingRows(el('[data-decoding-results]'), study.rows)
          el('[data-decoding-progress]').textContent = `${study.rows.length} / ${DECODING_ROW_COUNT} · ${row.policy} · ${row.profile} · ${row.filter}`
        }, () => cancelSweep || destroyed)
        study.status = cancelSweep || destroyed ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error); runError = study.error } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          for (const lane of ['webgl', 'webgpu'] as const) {
            if (selected) installDecoded(backends[lane]!, selected)
            else backends[lane]!.atlas.replace(previous[lane]?.images)
          }
          restoreSelectControls()
          el<HTMLSelectElement>('[data-atlas-packing]').disabled = dynamicActive || decodingActive
          el<HTMLSelectElement>('[data-decode-policy]').disabled = !decodingActive || el<HTMLSelectElement>('[data-renderer]').value === 'production'
          exportButton.disabled = !report; setSweepDisabled(false); el<HTMLButtonElement>('[data-decoding-cancel]').disabled = true
          el('[data-decoding-progress]').textContent = `${study.status} · ${study.rows.length} / ${DECODING_ROW_COUNT} · ` +
            `${study.rows.filter(row => !row.passed).length} rows rejected. All controls retained; live source restored.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error); status.textContent = runError })
  })
  host.querySelector('[data-effects-cancel]')?.addEventListener('click', () => { if (sweepRunning) cancelSweep = true })
  host.querySelector('[data-effects-sweep]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const runSweep = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false; runError = undefined
      const study = {
        startedAt: new Date().toISOString(),
        finishedAt: undefined as string | undefined,
        status: 'running',
        browser: navigator.userAgent,
        devices: Object.values(backends).map(b => b.info),
        rows: [] as EffectsRow[],
        error: undefined as string | undefined,
      }
      effectsStudy = study
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      setSweepDisabled(true); exportButton.disabled = true; el<HTMLButtonElement>('[data-effects-cancel]').disabled = false
      el('[data-effects-results]').replaceChildren(); el('[data-effects-progress]').textContent = `Starting ${EFFECTS_ROW_COUNT} ring/greyout rows…`
      try {
        await runEffectsSweep({ webgl: backends.webgl!, webgpu: backends.webgpu! }, row => {
          study.rows.push(row)
          if (destroyed) return
          renderEffectsRows(el('[data-effects-results]'), study.rows)
          el('[data-effects-progress]').textContent = `${study.rows.length} / ${EFFECTS_ROW_COUNT} · ${row.fixture} · ${row.profile} · ${row.view}`
        }, () => cancelSweep || destroyed, undefined,
        el<HTMLSelectElement>('[data-polygon-arithmetic]').value === 'pixels' ? 'pixels' : undefined,
        el<HTMLSelectElement>('[data-overlay-arithmetic]').value === 'pixels' ? 'pixels' : undefined)
        study.status = cancelSweep || destroyed ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error); runError = study.error } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          restoreSelectControls(); exportButton.disabled = !report; setSweepDisabled(false)
          el<HTMLButtonElement>('[data-effects-cancel]').disabled = true
          el('[data-effects-progress]').textContent = `${study.status} · ${study.rows.length} / ${EFFECTS_ROW_COUNT} · ` +
            `${study.rows.filter(row => !row.passed).length} rows rejected. Exact boundary failures and production controls retained.`
        }
      }
    }
    runSweep().catch(error => { runError = String(error); status.textContent = runError })
  })
  host.querySelector('[data-stored-alpha]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed || !backends.webgl || !backends.webgpu) return
    const replay = async (): Promise<void> => {
      sweepRunning = true; setSweepDisabled(true); exportButton.disabled = true
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      const rows: Array<StoredAlphaRow & { lane: string }> = []
      const study = {
        policy: 'stored-alpha-v1',
        startedAt: new Date().toISOString(),
        finishedAt: undefined as string | undefined,
        status: 'running',
        error: undefined as string | undefined,
        browser: navigator.userAgent,
        region: { x: 250, y: 154, width: 14, height: 14 },
        rows,
      }
      storedStudy = study
      el('[data-stored-results]').replaceChildren(); el('[data-stored-progress]').textContent = 'Running stored-alpha replay…'
      try {
        for (const lane of ['webgl', 'webgpu'] as const) {
          rows.push(...(await storedAlphaReplay(backends[lane]!)).map(row => ({ ...row, lane })))
          if (destroyed) return
          renderStoredAlphaRows(el('[data-stored-results]'), rows)
        }
        const failures = rows.filter(r => r.changedColors || r.cpuMismatches || r.invisiblePicks).length
        study.status = failures ? 'failed' : 'passed'
        el('[data-stored-progress]').textContent = `${failures ? 'Fail' : 'Pass'} · ${rows.length} live rows · ` +
          `${failures} failed · ${new Date().toLocaleString()}. CPU replays measured masks; geometry tests run separately. ` +
          'Rings, production latency and broader device coverage remain unchecked.'
      } catch (error) {
        study.status = 'unavailable'; study.error = String(error)
        if (!destroyed) el('[data-stored-progress]').textContent = `Unavailable: ${study.error}`
      } finally {
        study.finishedAt = new Date().toISOString()
        if (destroyed) study.status = 'cancelled'
        sweepRunning = false
        if (destroyed) disposeBackends()
        else { restoreSelectControls(); exportButton.disabled = !report; setSweepDisabled(false) }
      }
    }
    replay().catch(error => { if (!destroyed) el('[data-stored-progress]').textContent = String(error) })
  })
  host.querySelector('[data-stored-cost-cancel]')?.addEventListener('click', () => { if (sweepRunning) cancelSweep = true })
  host.querySelector('[data-stored-cost]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed) return
    const runCost = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false; setSweepDisabled(true); exportButton.disabled = true
      el<HTMLButtonElement>('[data-stored-cost-cancel]').disabled = false
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      const study = {
        startedAt: new Date().toISOString(),
        finishedAt: undefined as string | undefined,
        status: 'running',
        browser: navigator.userAgent,
        error: undefined as string | undefined,
        policy: STORED_ALPHA_COST_POLICY,
        rows: [] as StoredAlphaCostRow[],
      }
      storedCost = study
      el('[data-stored-cost-results]').replaceChildren(); el('[data-stored-cost-progress]').textContent = 'Preparing dedicated timing devices…'
      try {
        await runStoredAlphaCost(row => {
          study.rows.push(row)
          if (destroyed) return
          renderStoredAlphaCost(el('[data-stored-cost-results]'), study.rows)
          el('[data-stored-cost-progress]').textContent = `${study.rows.length} / 16 · ${row.lane} · ${row.count} points / ${row.overlapping} overlapping`
        }, () => cancelled())
        study.status = cancelled() ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error) } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          restoreSelectControls(); setSweepDisabled(false); exportButton.disabled = !report
          el<HTMLButtonElement>('[data-stored-cost-cancel]').disabled = true
          const note = study.error ??
            'GPU sums exclude between-pass gaps; wall completion includes encoding and waiting. Not production hover latency.'
          el('[data-stored-cost-progress]').textContent =
            `${study.status} · ${study.rows.length} / 16 validated rows · ${study.finishedAt}. ${note}`
        }
      }
    }
    const cancelled = (): boolean => cancelSweep || destroyed
    runCost().catch(error => { if (!destroyed) el('[data-stored-cost-progress]').textContent = String(error) })
  })
  host.querySelector('[data-filtered-cost-cancel]')?.addEventListener('click', () => { if (sweepRunning) cancelSweep = true })
  host.querySelector('[data-filtered-cost]')?.addEventListener('click', () => {
    if (busy || sweepRunning || destroyed) return
    const runCost = async (): Promise<void> => {
      sweepRunning = true; cancelSweep = false; setSweepDisabled(true); exportButton.disabled = true
      el<HTMLButtonElement>('[data-filtered-cost-cancel]').disabled = false
      host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = true })
      const study = {
        startedAt: new Date().toISOString(),
        finishedAt: undefined as string | undefined,
        status: 'running',
        browser: navigator.userAgent,
        error: undefined as string | undefined,
        policy: 'stored-alpha-v1 / conservative-filter-v1',
        rows: [] as FilteredAlphaCostRow[],
      }
      filteredCost = study
      el('[data-filtered-cost-results]').replaceChildren(); el('[data-filtered-cost-progress]').textContent = 'Preparing dedicated timing devices…'
      try {
        await runFilteredAlphaCost(row => {
          study.rows.push(row)
          if (destroyed) return
          renderFilteredAlphaCost(el('[data-filtered-cost-results]'), study.rows)
          el('[data-filtered-cost-progress]').textContent = `${study.rows.length} / 16 · ${row.lane} · ${row.count} points / ${row.overlapping} overlapping`
        }, () => cancelled())
        study.status = cancelled() ? 'cancelled' : 'complete'
      } catch (error) { study.status = 'failed'; study.error = String(error) } finally {
        study.finishedAt = new Date().toISOString(); sweepRunning = false
        if (destroyed) disposeBackends()
        else {
          restoreSelectControls(); setSweepDisabled(false); exportButton.disabled = !report
          el<HTMLButtonElement>('[data-filtered-cost-cancel]').disabled = true
          const note = study.error ??
            ('Exact IDs and colors compared with the prototype. Request wall includes filtering and setup; ' +
            'scene rendering and readback excluded. Not production hover latency.')
          el('[data-filtered-cost-progress]').textContent =
            `${study.status} · ${study.rows.length} / 16 validated rows · ${study.finishedAt}. ${note}`
        }
      }
    }
    const cancelled = (): boolean => cancelSweep || destroyed
    runCost().catch(error => { if (!destroyed) el('[data-filtered-cost-progress]').textContent = String(error) })
  })
  mountRunLayout(host, () => summarizeRun(
    busy || sweepRunning ? 'Running' : report ? 'Complete' : 'Preparing',
    [latestComparison, ...(latestContribution === undefined ? [] : [latestContribution]),
      ...(latestColorPreservation === undefined ? [] : [latestColorPreservation]),
      ...(latestAtlasColors === undefined ? [] : [latestAtlasColors]),
      ...(latestIsolation === undefined ? [] : [latestIsolation]),
      ...(latestCompatibility === undefined ? [] : [latestCompatibility]),
      ...(latestDecoding === undefined ? [] : [latestDecoding]),
      ...(latestEffects === undefined ? [] : [latestEffects])],
    'Other fixtures, pointer-hover tolerance and production picking latency.',
    Object.keys(errors),
    runError,
    'full-image styling and picking comparisons'), {
    experiment,
    scope: 'The selected scene, renderer and settings in this session. Recorded studies cover their own inputs.',
    devices: () => Object.values(backends).map(b => b.info),
    secondarySettings: [
      '[data-overlay-arithmetic]', '[data-polygon-arithmetic]', '[data-image-filter]', '[data-decode-policy]',
      '[data-atlas-packing]', '[data-atlas-isolation]', '[data-zoom]', '[data-ratio]', '[data-scale]', '[data-opacity]',
      ...(caseId === 'picking' ? [] : ['[data-order]']),
    ],
  })
  refreshStylingCase(host, caseId)
  for (const [name, create] of [['webgl', createStylingWebGL], ['webgpu', createStylingWebGPU]] as const) {
    try {
      const backend = await create(el<HTMLCanvasElement>(`[data-canvas="${name}"]`)); backends[name] = backend
    } catch (error) {
      runError = String(error)
      errors[name] = String(error); el(`[data-state="${name}"]`).textContent = 'Unavailable'
      el(`[data-device="${name}"]`).textContent = String(error)
    }
  }
  try { await render() } catch (error) { runError = String(error); disposeBackends(); throw error }
  return {
    destroy (): void {
      disposeRunLayout(host); destroyed = true; cancelSweep = true
      if (!busy && !sweepRunning) disposeBackends()
    },
  }
}
