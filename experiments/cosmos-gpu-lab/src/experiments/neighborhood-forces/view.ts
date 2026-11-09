import { luma } from '@luma.gl/core'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'
import type { ExperimentInstance } from '../../runtime/experiment'
import { BATCH_POLICY } from './gpu-timer'
import { COMPARISON_SEED, createPrecisionPlan, runPrecisionComparison, type PrecisionRow } from './precision-comparison'
import { createNeighborhoodBackend, type NeighborhoodBackend, type Timing } from './backend'
import { BRUTE_LIMIT, createPositions, DEFAULT_PARAMETERS, type Distribution, type Validation } from './reference'
import { createSweepPlan, runSweep, type SweepPreset, type SweepRow } from './sweep'

function element<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

export async function createNeighborhoodExperiment (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `
    <section class="neighborhood-demo">
      <div class="scale-toolbar">
        <label><span>Points</span><select data-control="count">
          <option>256</option><option selected>1024</option><option>4096</option>
          <option>16384</option><option>65536</option>
        </select></label>
        <label><span>Distribution</span><select data-control="distribution">
          <option value="uniform">Uniform</option><option value="clusters">Eight clusters</option>
          <option value="diagonal">Diagonal</option><option value="boundary">Boundary + coincidence</option>
        </select></label>
        <label><span>Radius</span><select data-control="radius">
          <option>0.04</option><option selected>0.08</option><option>0.16</option>
        </select></label>
        <label><span>Density multiplier</span><select data-control="density">
          <option value="1">1× area density</option><option value="4">4× area density</option>
          <option value="16">16× area density</option>
        </select></label>
        <label><span>Grid</span><select data-control="grid">
          <option value="16">16 × 16</option><option value="32" selected>32 × 32</option>
          <option value="64">64 × 64</option>
        </select></label>
        <label><span>Grid force loop</span><select data-control="accumulation">
          <option value="blocked" selected>Baseline · per-candidate checks</option>
          <option value="chunked">Chunked · fewer inner-loop checks</option>
        </select></label>
      </div>
      <div class="demo-toolbar">
        <div class="controls">
          <button data-action="step">Step</button><button data-action="play">Play</button>
          <button data-action="reset">Reset</button><button data-action="validate">Validate next step</button>
          <button data-action="precision">Check dense precision</button>
          <button data-action="precision-cost">Compare precision cost</button>
          <button data-action="benchmark">Benchmark</button><button data-action="export" disabled>Export JSON</button>
        </div>
        <span>Tick <strong data-output="tick">0</strong></span>
      </div>
      <p class="demo-note">Local repulsion within a fixed radius · identical inputs and circle rendering ·
        damping and reflecting walls · no per-tick CPU readback. This is not the global many-body force.</p>
      <div class="scale-status" role="status"><span data-output="status">Creating WebGPU resources…</span></div>
      <p class="demo-note" data-output="gpu-timing">Checking GPU timestamp support…</p>
      <p class="demo-note">Check dense precision compares the original and fixed shaders at 65,536 points,
        16× density and radius 0.16 across all three grids. It takes about a minute and leaves the demo settings unchanged.</p>
      <p class="demo-note">Compare precision cost runs 72 paired rows across dense, sparse and small inputs, measuring force and complete ticks.
        Keep this tab visible; use Cancel sweep to stop and export partial results.</p>
      <div class="grid-pipeline"><span>positions</span><b>→</b><span>grid</span><b>→</b>
        <span>local forces</span><b>→</b><span>integration</span><b>→</b><span>circles</span></div>
      <div class="backend-panels">
        <section class="backend-panel"><h2>Tiled all-pairs</h2>
          <p>WebGPU · reference path · up to 4,096 points</p>
          <canvas data-canvas="brute" width="480" height="480" aria-label="All-pairs simulation"></canvas>
          <p data-validation="brute">Not validated</p>
        </section>
        <section class="backend-panel"><h2>Spatial grid</h2>
          <p>WebGPU · count, scan, scatter + neighbor traversal</p>
          <canvas data-canvas="grid" width="480" height="480" aria-label="Grid simulation"></canvas>
          <p data-validation="grid">Not validated</p>
        </section>
      </div>
      <p class="demo-note" data-output="search"></p>
      <section data-output="timings" aria-live="polite"></section>
      <section class="neighborhood-sweep">
        <h2>Repeatable parameter sweep</h2>
        <p class="demo-note">Uniform positions compressed into 1×, 4× or 16× density.
          Sweeps use the baseline loop and their own fixed parameter matrix, independent of the demo controls above.
          Each row validates first, then measures all stages on a separate 480×480 canvas.</p>
        <div class="scale-toolbar">
          <label><span>Sweep matrix</span><select data-sweep="preset">
            <option value="quick">Quick · 16 configurations</option>
            <option value="standard">Standard · 81 configurations</option>
            <option value="large">Large · 108 configurations · up to 65,536 points</option>
          </select></label>
          <label><span>Repetitions</span><select data-sweep="repeats">
            <option>1</option><option selected>2</option><option>3</option>
          </select></label>
          <label><span>Order seed</span><input data-sweep="seed" type="number" min="0" max="4294967295" step="1" value="20261109"></label>
          <div class="controls"><button data-action="sweep">Run sweep</button>
            <button data-action="cancel-sweep" disabled>Cancel sweep</button>
            <button data-action="export-sweep" disabled>Export sweep JSON</button></div>
        </div>
        <p data-output="sweep-plan" class="demo-note"></p>
        <p data-output="sweep-status" role="status">Not run. Larger matrices can take several minutes.</p>
        <progress data-output="sweep-progress" value="0" max="1" aria-label="Sweep progress"></progress>
        <div class="benchmark-table-wrap"><table class="neighborhood-timings">
          <thead><tr><th>Run / method</th><th>Points / density</th><th>Radius / cell width</th>
            <th>Status</th><th>Mean candidates</th><th>Tick batch</th><th>GPU ms/tick p50</th><th>Wall ms/tick p50</th></tr></thead>
          <tbody data-output="sweep-rows"></tbody></table></div>
      </section>
    </section>
  `
  const status = element<HTMLElement>(host, '[data-output="status"]')
  const tick = element<HTMLElement>(host, '[data-output="tick"]')
  const play = element<HTMLButtonElement>(host, '[data-action="play"]')
  const exportButton = element<HTMLButtonElement>(host, '[data-action="export"]')
  const timings = element<HTMLElement>(host, '[data-output="timings"]')
  let device: WebGPUDevice | undefined
  let backends: NeighborhoodBackend[] = []
  let busy = false
  let playing = false
  let destroyed = false
  let revision = 0
  let frame = 0
  let report: object | undefined
  let sweepReport: object | undefined
  let sweeping = false
  let cancelSweep = false
  const sweepStatus = element<HTMLElement>(host, '[data-output="sweep-status"]')
  const progress = element<HTMLProgressElement>(host, '[data-output="sweep-progress"]')
  const sweepRows = element<HTMLTableSectionElement>(host, '[data-output="sweep-rows"]')
  let options = {
    count: 1024,
    gridSize: 32,
    distribution: 'uniform' as Distribution,
    radius: 0.08,
    density: 1,
    accumulation: 'blocked' as 'blocked' | 'chunked',
  }
  let validations: Record<string, Validation> = {}

  const controls = (): void => {
    for (const control of host.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button, select, input')) {
      control.disabled = busy || playing || (control.tagName === 'BUTTON' && backends.length === 0)
    }
    play.disabled = (busy && !playing) || backends.length === 0
    play.textContent = playing ? 'Pause' : 'Play'
    exportButton.disabled = busy || playing || !report
    element<HTMLButtonElement>(host, '[data-action="cancel-sweep"]').disabled = !sweeping || cancelSweep
    element<HTMLButtonElement>(host, '[data-action="export-sweep"]').disabled = !sweepReport
  }
  const pause = (): void => {
    playing = false
    window.cancelAnimationFrame(frame)
    controls()
  }
  const fail = (error: unknown): void => {
    if (destroyed) return
    pause()
    status.textContent = error instanceof Error ? error.message : String(error)
  }
  const clearResults = (): void => {
    validations = {}
    report = undefined
    timings.replaceChildren()
    for (const label of host.querySelectorAll<HTMLElement>('[data-validation]')) {
      label.textContent = label.dataset.validation === 'brute' && options.count > BRUTE_LIMIT
        ? 'Skipped above 4,096 points; grid validation uses sampled CPU references.'
        : 'Not validated'
    }
  }
  const configure = async (): Promise<void> => {
    const current = ++revision
    busy = true
    pause()
    for (const backend of backends) backend.destroy()
    backends = []
    device?.destroy()
    device = undefined
    options = {
      accumulation: element<HTMLSelectElement>(host, '[data-control="accumulation"]').value as 'blocked' | 'chunked',
      count: Number(element<HTMLSelectElement>(host, '[data-control="count"]').value),
      gridSize: Number(element<HTMLSelectElement>(host, '[data-control="grid"]').value),
      radius: Number(element<HTMLSelectElement>(host, '[data-control="radius"]').value),
      density: Number(element<HTMLSelectElement>(host, '[data-control="density"]').value),
      distribution: element<HTMLSelectElement>(host, '[data-control="distribution"]').value as Distribution,
    }
    clearResults()
    tick.textContent = '0'
    status.textContent = 'Creating WebGPU pipelines…'
    const reach = Math.ceil(options.radius * options.gridSize / 2)
    element<HTMLElement>(host, '[data-output="search"]').textContent =
      `Cell width ${(2 / options.gridSize).toFixed(4)} · search up to ${2 * reach + 1} × ${2 * reach + 1} cells, ` +
      'clipped at walls. Both methods apply the same exact distance test. Dense cells can still be expensive.'
    try {
      const nextDevice = await luma.createDevice({
        id: `neighborhood-${current}`,
        type: 'webgpu',
        adapters: [webgpuAdapter],
        waitForPageLoad: false,
        featureLevel: 'core',
        optionalFeatures: ['timestamp-query'],
        onError: error => { if (current === revision) fail(error) },
      }) as WebGPUDevice
      if (destroyed || current !== revision) { nextDevice.destroy(); return }
      device = nextDevice
      element<HTMLElement>(host, '[data-output="gpu-timing"]').textContent = device.features.has('timestamp-query')
        ? 'GPU timestamps enabled · calibrated batches report GPU and wall milliseconds per operation separately.'
        : 'GPU timestamps unavailable on this device · browser wall-time measurements remain available.'
      const initial = createPositions(options.count, options.distribution, options.density)
      const methods = options.count <= BRUTE_LIMIT ? ['brute', 'grid'] as const : ['grid'] as const
      element<HTMLCanvasElement>(host, '[data-canvas="brute"]').hidden = options.count > BRUTE_LIMIT
      for (const method of methods) {
        const backend = await createNeighborhoodBackend(device, initial,
          { ...DEFAULT_PARAMETERS, radius: options.radius }, options.gridSize, method,
          element<HTMLCanvasElement>(host, `[data-canvas="${method}"]`), method === 'grid' ? options.accumulation : 'blocked')
        if (destroyed || current !== revision) { backend.destroy(); return }
        backends.push(backend)
      }
      status.textContent = 'Ready. Step or play to see motion; validate to compare forces and integration with the CPU.'
    } catch (error) {
      for (const backend of backends) backend.destroy()
      backends = []
      device?.destroy()
      device = undefined
      fail(error)
    } finally {
      if (!destroyed && current === revision) { busy = false; controls() }
    }
  }
  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (busy || destroyed || backends.length === 0) return
    busy = true
    controls()
    try { await action() } catch (error) { fail(error) } finally {
      if (!destroyed) { busy = false; controls() }
    }
  }
  const step = async (): Promise<void> => {
    for (const backend of backends) {
      if (destroyed) return
      await backend.step()
    }
    if (destroyed) return
    tick.textContent = String(backends[0].ticks)
    report = undefined
    validations = {}
    timings.replaceChildren()
    for (const backend of backends) {
      element<HTMLElement>(host, `[data-validation="${backend.method}"]`).textContent = 'State changed; validate this tick separately.'
    }
  }
  const loop = (): void => {
    if (!playing || destroyed) return
    perform(step).then(() => {
      if (playing && !destroyed) frame = window.requestAnimationFrame(loop)
    })
  }
  const validate = async (): Promise<void> => {
    status.textContent = 'Checking the next force and integration step against the CPU; displayed tick stays unchanged…'
    for (const backend of backends) {
      const result = await backend.validate()
      if (destroyed) return
      validations[backend.method] = result
      element<HTMLElement>(host, `[data-validation="${backend.method}"]`).textContent =
        `${result.valid ? 'PASS' : 'FAIL'} · ${result.checked}/${result.total} points checked · ` +
        `neighbor mismatches ${result.neighborMismatches} · max force error ${result.maximumForceError.toExponential(2)} · ` +
        `max position error ${result.maximumPositionError.toExponential(2)} · ` +
        `mean candidates ${result.meanCandidates.toFixed(1)}`
    }
    status.textContent = 'Validation complete. Large datasets use 128 deterministic CPU samples; all GPU outputs are checked for non-finite values.'
  }
  element<HTMLButtonElement>(host, '[data-action="step"]').onclick = (): void => { perform(step) }
  play.onclick = (): void => {
    if (playing) {
      pause()
      status.textContent = 'Paused. Any in-flight tick will finish before the controls become available.'
      return
    }
    if (busy || backends.length === 0) return
    playing = true
    status.textContent = 'Running fixed 1/60-second simulation steps. Both methods advance one tick together.'
    controls()
    loop()
  }
  element<HTMLButtonElement>(host, '[data-action="reset"]').onclick = (): void => {
    for (const backend of backends) backend.reset()
    tick.textContent = '0'
    clearResults()
    status.textContent = 'Reset to identical deterministic positions and zero velocities.'
    controls()
  }
  element<HTMLButtonElement>(host, '[data-action="validate"]').onclick = (): void => {
    perform(async () => {
      await validate()
      report = {
        schemaVersion: 1,
        experiment: 'neighborhood-forces',
        recordedAt: new Date().toISOString(),
        parameters: { ...options, ...DEFAULT_PARAMETERS, radius: options.radius },
        tick: backends[0].ticks,
        environment: { userAgent: navigator.userAgent },
        validations,
      }
    })
  }
  element<HTMLButtonElement>(host, '[data-action="precision-cost"]').onclick = (): void => {
    perform(async () => {
      if (!device) return
      const rows: PrecisionRow[] = []
      const output = {
        schemaVersion: 2,
        experiment: 'precision-cost',
        startedAt: new Date().toISOString(),
        completedAt: null as string | null,
        status: 'running',
        orderSeed: COMPARISON_SEED,
        plan: createPrecisionPlan(),
        kernels: { blocked: 'blocked-64x16-rounded-cutoff-v1', chunked: 'chunked-64x16-rounded-cutoff-v1' },
        generator: 'createGridPositions hash v1; uniform; positions divided by sqrt(density)',
        warmups: 2,
        samples: 8,
        batchPolicy: BATCH_POLICY,
        forceParameters: DEFAULT_PARAMETERS,
        renderSurface: 'detached 480x480 canvas',
        methodology: 'Paired variants, reversed per repetition; shuffled configurations; frozen-input calibrated batches. ' +
          'Force excludes grid build; tick includes grid, force, integration and rendering. Validation before timing; readback outside timing.',
        environment: {
          adapter: { ...device.info },
          userAgent: navigator.userAgent,
          timestampQuery: device.features.has('timestamp-query'),
          hardwareConcurrency: navigator.hardwareConcurrency,
        },
        rows,
      }
      report = output
      sweeping = true
      cancelSweep = false
      controls()
      try {
        await runPrecisionComparison(device, () => destroyed || cancelSweep || document.hidden,
          message => { if (!destroyed) status.textContent = message }, rows)
        output.status = rows.length !== 72
          ? 'cancelled'
          : rows.some(row => !row.validation.valid || row.evolvedValidation?.valid === false)
            ? 'complete-with-failures'
            : 'complete'
      } catch (error) {
        output.status = destroyed || cancelSweep || document.hidden ? 'cancelled' : 'failed'
        if (output.status === 'failed') throw error
      } finally {
        output.completedAt = new Date().toISOString()
        sweeping = false
      }
      status.textContent = `Precision cost ${output.status}: ${rows.filter(row => row.validation.valid).length}/${rows.length} initial checks passed; ` +
        `${rows.filter(row => row.evolvedValidation?.valid).length}/18 evolved checks passed. Export JSON to compare.`
    })
  }
  element<HTMLButtonElement>(host, '[data-action="precision"]').onclick = (): void => {
    perform(async () => {
      if (!device) return
      const rows: object[] = []
      report = {
        schemaVersion: 1,
        experiment: 'dense-precision',
        variant: 'blocked-64x16-rounded-cutoff-v1',
        parameters: { count: 65536, density: 16, radius: 0.16, baselineSamples: 128, additionalSamples: 1024, repetitions: 4 },
        recordedAt: new Date().toISOString(),
        environment: { userAgent: navigator.userAgent, adapter: { ...device.info } },
        rows,
      }
      for (let repetition = 0; repetition < 4; repetition += 1) {
        for (const gridSize of [16, 32, 64]) {
          for (const accumulation of (repetition % 2 ? ['blocked', 'serial'] : ['serial', 'blocked']) as Array<'serial' | 'blocked'>) {
            if (destroyed) return
            status.textContent = `Dense precision: repetition ${repetition + 1}/4, grid ${gridSize}, ${accumulation}…`
            await new Promise<void>(resolve => window.setTimeout(resolve, 0))
            const backend = await createNeighborhoodBackend(device, createPositions(65536, 'uniform', 16),
              { ...DEFAULT_PARAMETERS, radius: 0.16 }, gridSize, 'grid', undefined, accumulation)
            try {
              const validation = await backend.validate(true, 1024)
              // Baseline timings are diagnostic only, even when serial validation fails.
              const timings = repetition < 2 ? await backend.benchmark(() => destroyed, 1, ['force']) : null
              let evolvedValidation: Validation | null = null
              if (accumulation === 'blocked' && repetition === 0) {
                for (let step = 0; step < 3; step += 1) await backend.step()
                evolvedValidation = await backend.validate(false, 1024)
              }
              rows.push({ repetition, gridSize, accumulation, validation, timings, evolvedValidation })
            } finally { backend.destroy() }
          }
        }
      }
      const results = rows as Array<{ accumulation: string; validation: Validation; evolvedValidation: Validation | null }>
      const fixed = results.filter(row => row.accumulation === 'blocked')
      const serial = results.filter(row => row.accumulation === 'serial')
      status.textContent = `Dense precision complete: blocked ${fixed.filter(row => row.validation.valid).length}/12 passed; ` +
        `serial ${serial.filter(row => row.validation.valid).length}/12 passed. ` +
        `Evolved checks ${fixed.filter(row => row.evolvedValidation?.valid).length}/3 passed. Export JSON for diagnostics and timings.`
    })
  }
  element<HTMLButtonElement>(host, '[data-action="benchmark"]').onclick = (): void => {
    perform(async () => {
      clearResults()
      for (const backend of backends) backend.reset()
      tick.textContent = '0'
      await validate()
      if (Object.values(validations).some(result => !result.valid)) throw new Error('Validation failed; benchmark was not run.')
      const results: Record<string, Timing[]> = {}
      for (const backend of backends) {
        if (destroyed) return
        status.textContent = `Benchmarking ${backend.method}: calibrated batches, two warm-ups and eight samples per stage…`
        // Yield for the progress label to paint before encoding the next stage set.
        await new Promise<void>(resolve => window.setTimeout(resolve, 0))
        results[backend.method] = await backend.benchmark(() => destroyed)
      }
      if (destroyed) return
      timings.innerHTML = `<h2>Frozen-input timings</h2><p class="demo-note">
        Times are per operation, averaged within calibrated batches. Wall time includes submission and queue completion.
        Query readback is outside both intervals. Only the first grid-counter clear in each batch is outside the GPU interval.
        Zero GPU durations can reflect timer quantization. “Unavailable” means no timestamp support or no valid samples.</p>
        <div class="benchmark-table-wrap"><table class="neighborhood-timings">
          <thead><tr><th>Method / stage</th><th>Batch size</th><th>Submit p50</th><th>Wall p50</th><th>Wall p95</th>
            <th>GPU p50</th><th>GPU p95</th><th>Invalid GPU samples</th></tr></thead>
          <tbody></tbody></table></div>`
      const body = element<HTMLTableSectionElement>(timings, 'tbody')
      for (const [method, measurements] of Object.entries(results)) {
        for (const result of measurements) {
          const row = document.createElement('tr')
          for (const text of [`${method} / ${result.stage}`, String(result.batchSize), ...[
            result.submit.p50, result.completion.p50, result.completion.p95,
          ].map(value => `${value.toFixed(3)} ms`),
          result.gpu ? `${result.gpu.p50.toFixed(4)} ms` : 'Unavailable',
          result.gpu ? `${result.gpu.p95.toFixed(4)} ms` : 'Unavailable', String(result.invalidGpuSamples)]) {
            const cell = document.createElement('td')
            cell.textContent = text
            row.append(cell)
          }
          body.append(row)
        }
      }
      report = {
        schemaVersion: 3,
        experiment: 'neighborhood-forces',
        recordedAt: new Date().toISOString(),
        parameters: { ...DEFAULT_PARAMETERS, ...options },
        warmups: 2,
        samples: 8,
        batchPolicy: BATCH_POLICY,
        forceKernel: { brute: 'blocked-64x16-rounded-cutoff-v1', grid: `${options.accumulation}-64x16-rounded-cutoff-v1` },
        methodology: 'Frozen input; calibrated batches; summaries and samples are milliseconds per operation; timestamps are whole-batch intervals.',
        environment: {
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          canvas: '480x480',
          devicePixelRatio: window.devicePixelRatio,
          timestampQuery: device?.features.has('timestamp-query') ?? false,
          adapter: device ? { ...device.info } : null,
        },
        validations,
        results,
      }
      status.textContent = 'Benchmark complete. Both simulations reset to tick 0. Export JSON to keep raw measurements.'
    })
  }
  exportButton.onclick = (): void => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...report, gpuApi: 'luma-resources-v1' }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'experiment' in report && report.experiment === 'precision-cost'
      ? 'neighborhood-precision-cost.json'
      : 'experiment' in report && report.experiment === 'dense-precision'
        ? 'neighborhood-dense-precision.json'
        : `neighborhood-forces-${options.count}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const sweepPlan = (): ReturnType<typeof createSweepPlan> => createSweepPlan(
    element<HTMLSelectElement>(host, '[data-sweep="preset"]').value as SweepPreset,
    Number(element<HTMLSelectElement>(host, '[data-sweep="repeats"]').value),
    Number(element<HTMLInputElement>(host, '[data-sweep="seed"]').value)
  )
  const describePlan = (): void => {
    try {
      const plan = sweepPlan()
      element<HTMLElement>(host, '[data-output="sweep-plan"]').textContent =
        `${plan.length} configuration runs · ${plan.length * 2} method rows (including explicit all-pairs skips above 4,096). ` +
        `Counts: ${[...new Set(plan.map(item => item.count))].sort((a, b) => a - b).join(', ')}; ` +
        `density: ${[...new Set(plan.map(item => item.density))].sort((a, b) => a - b).join(', ')}×; ` +
        `radii: ${[...new Set(plan.map(item => item.radius))].sort().join(', ')}; ` +
        `cell widths: ${[...new Set(plan.map(item => 2 / item.gridSize))].sort().join(', ')}.`
    } catch (error) { sweepStatus.textContent = error instanceof Error ? error.message : String(error) }
  }
  element<HTMLButtonElement>(host, '[data-action="sweep"]').onclick = (): void => {
    perform(async () => {
      if (!device) return
      const plan = sweepPlan()
      const orderSeed = Number(element<HTMLInputElement>(host, '[data-sweep="seed"]').value)
      const preset = element<HTMLSelectElement>(host, '[data-sweep="preset"]').value
      const rows: SweepRow[] = []
      const output = {
        schemaVersion: 3,
        experiment: 'neighborhood-forces-sweep',
        startedAt: new Date().toISOString(),
        completedAt: null as string | null,
        status: 'running',
        preset,
        orderSeed,
        plan,
        generator: 'createGridPositions hash v1; uniform; positions divided by sqrt(density)',
        warmups: 2,
        samples: 8,
        batchPolicy: BATCH_POLICY,
        forceKernel: 'blocked-64x16-rounded-cutoff-v1',
        forceParameters: DEFAULT_PARAMETERS,
        renderSurface: 'detached 480x480 canvas',
        environment: {
          userAgent: navigator.userAgent,
          adapter: { ...device.info },
          timestampQuery: device.features.has('timestamp-query'),
          hardwareConcurrency: navigator.hardwareConcurrency,
        },
        methodology: 'Frozen-input calibrated batches; per-operation summaries; raw whole-batch timestamps; ' +
          'reversed method order per repetition; readback outside wall time.',
        rows,
      }
      sweepReport = output
      sweeping = true
      cancelSweep = false
      sweepRows.replaceChildren()
      progress.value = 0
      progress.max = plan.length * 2
      sweepStatus.textContent = 'Running sweep. Keep this tab visible for comparable wall-time measurements.'
      controls()
      try {
        await runSweep(device, plan, () => cancelSweep || destroyed || document.hidden,
          (row, completed, total) => {
            rows.push(row)
            if (destroyed) return
            progress.value = completed
            sweepStatus.textContent = `${completed}/${total} rows recorded · ${row.method}, ${row.count} points, ` +
              `${row.density}× density, radius ${row.radius}, cell width ${row.cellWidth}.`
            const tr = document.createElement('tr')
            const timing = row.timings?.find(item => item.stage === 'tick')
            for (const value of [`${row.repetition + 1} / ${row.method}`, `${row.count} / ${row.density}×`,
              `${row.radius} / ${row.cellWidth}`, row.reason ?? row.status,
              row.validation?.meanCandidates.toFixed(1) ?? '—', String(timing?.batchSize ?? '—'),
              timing?.gpu ? `${timing.gpu.p50.toFixed(4)} ms` : 'Unavailable',
              timing ? `${timing.completion.p50.toFixed(3)} ms` : '—']) {
              const td = document.createElement('td')
              td.textContent = value
              tr.append(td)
            }
            sweepRows.append(tr)
          })
        output.status = cancelSweep || destroyed || document.hidden || rows.length < plan.length * 2
          ? 'cancelled'
          : rows.some(row => row.status === 'failed') ? 'complete-with-failures' : 'complete'
      } catch (error) {
        output.status = 'failed'
        throw error
      } finally {
        output.completedAt = new Date().toISOString()
        sweeping = false
        if (!destroyed) {
          sweepStatus.textContent = `Sweep ${output.status}: ${rows.length}/${plan.length * 2} rows. ` +
            'Export includes partial results and failures.'
        }
      }
    })
  }
  element<HTMLButtonElement>(host, '[data-action="cancel-sweep"]').onclick = (): void => {
    cancelSweep = true
    sweepStatus.textContent = 'Cancelling after the current GPU submission completes…'
    controls()
  }
  element<HTMLButtonElement>(host, '[data-action="export-sweep"]').onclick = (): void => {
    if (!sweepReport) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...sweepReport, gpuApi: 'luma-resources-v1' }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'neighborhood-forces-sweep.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  for (const select of host.querySelectorAll<HTMLSelectElement>('[data-control]')) select.onchange = (): void => { configure() }
  for (const control of host.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-sweep]')) control.onchange = describePlan
  describePlan()
  configure()
  return {
    destroy (): void {
      destroyed = true
      revision += 1
      pause()
      for (const backend of backends) backend.destroy()
      device?.destroy()
    },
  }
}
