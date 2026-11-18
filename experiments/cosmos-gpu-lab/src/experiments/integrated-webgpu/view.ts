import type { ExperimentInstance } from '../../runtime/experiment'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import { gpuTimingProtocol, hubComparisonProtocol, gpuLargeMatrix, profileGpuTiming, gpuTimingVerdict, type GpuTimingRow } from './gpu-timing'
import { createIntegrated } from './runtime'
import { workload, matrix, unsupported, type Workload } from './data'
import { evaluate, interactionCheck, protocol, percentiles } from './evaluate'
import { pacingProtocol, profilePacing, pacingVerdict, type PacingRow } from './pacing'
import { starProfileProtocol, profileStarStages, type StarProfileRow } from './star-profile'
import { fit, validateFrame } from './validation'
export async function createView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar">
    <label>Graph <select data-kind><option>chain</option><option>communities</option><option>star</option><option>karate</option></select></label>
    <label>Points <select data-count><option>1024</option><option>8192</option></select></label>
    <p>Karate Club uses its original 34 points and 78 weighted links.</p></div>
    <div class="controls"><button data-action="step" data-run-action="primary">Step</button>
    <button data-action="run" data-run-action="primary">Run</button><button data-action="pause" data-run-action="primary">Pause</button>
    <button data-action="replace" data-run-action="primary">Replace graph / reset</button><button data-action="fit" data-run-action="primary">Fit</button></div>
    <p role="status" data-run-part="status">Creating the integrated WebGPU runtime…</p>
    <section data-run-part="visualization"><canvas width="960" height="600" aria-label="Interactive integrated WebGPU graph"
      style="width:100%;aspect-ratio:8/5;display:block;touch-action:none"></canvas>
    <p>Click a circle to select it; drag to move it. Drag empty space to pan; scroll to zoom. Selection turns yellow.
    The graph stays paused until Run. Fit downloads positions once; ordinary frames do not.</p></section>
    <section data-run-part="results"><p data-device></p><div data-report></div></section>
    <section data-run-part="diagnostics"><h3>Declared local evaluation</h3><p>${protocol}</p>
    <div class="controls"><button data-action="check">Check interaction + pixels</button><button data-action="measure">Measure this graph</button>
    <button data-action="matrix">Evaluate declared matrix</button><button data-action="cancel">Cancel evaluation</button>
    <button data-action="export">Export JSON</button><button data-action="pacing">Profile small-graph pacing</button>
    <button data-action="gpu-timing">Compare GPU timestamps</button>
    <button data-action="gpu-large">Time 8,192-point graphs</button>
    <button data-action="star-pacing">Profile star pacing</button><button data-action="star-stages">Profile star stages</button>
    <button data-action="hub-compare">Compare hub prefetch</button></div>
    <p>Matrix order: 1,024 chain, communities, star; then 8,192 chain, communities, star; then Karate Club.
    The matrix first checks 1,024-point picking and dragging.
    An incorrect initial interaction blocks scaling; timing misses remain failures while the diagnostic matrix continues.</p>
    <p>${pacingProtocol}</p><p>${gpuTimingProtocol}</p><p>${starProfileProtocol}</p><p>${hubComparisonProtocol}</p></section>
    <section data-run-part="explanation"><h3>Supported first slice</h3><p>Corrected resident repulsion, weighted directional springs,
    gravity, high/low center reduction and cooling. Circles and solid straight links read the same positions. Picking reads one RGBA8 ID pixel.</p>
    <h3>Unsupported options</h3><p>${unsupported}</p><p>Strict compatibility: historical failures remain.
    First-slice usability: requires this declared local evaluation.
    Full migration readiness: not established.</p></section>`
  const canvas = host.querySelector('canvas')!; const status = host.querySelector<HTMLElement>('[role=status]')!
  const report = host.querySelector<HTMLElement>('[data-report]')!
  const kind = host.querySelector<HTMLSelectElement>('[data-kind]')!; const count = host.querySelector<HTMLSelectElement>('[data-count]')!
  let destroyed = false; let busy = false; let cancelled = false; let checks = 'No checks yet'; let failure = ''
  const records: unknown[] = []
  const runtime = await createIntegrated(canvas)
  runtime.resize(960, 600, devicePixelRatio)
  host.querySelector<HTMLElement>('[data-device]')!.textContent = runtime.info
  mountRunLayout(host, () => ({
    state: busy ? 'Evaluating' : runtime.running ? 'Running' : 'Paused',
    passed: checks,
    failed: failure || runtime.error || 'None recorded',
    unchecked: 'Strict pixel compatibility, physical display latency and full migration readiness.',
  }), { experiment: 'integrated-webgpu', devices: () => [runtime.info] })
  const update = (): void => {
    host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
      button.disabled = busy && button.dataset.action !== 'cancel'
    })
    kind.disabled = busy; count.disabled = busy; canvas.style.pointerEvents = busy ? 'none' : 'auto'
    if (!busy) {
      const points = runtime.data.input.points.length / 4; const links = runtime.data.graph.links.length / 2
      status.textContent = `${runtime.running ? 'Running' : 'Paused'} · tick ${runtime.tick} · ` +
        `${points} points · ${links} links · ${runtime.springOptimization}${
          runtime.feedback.length
            ? ` · selected ${runtime.renderer.selected < 0 ? 'none' : runtime.renderer.selected}` +
            ` · last pick ${runtime.feedback.at(-1)!.ms.toFixed(1)} ms`
            : ''}`
    }
  }
  const show = (value: unknown): void => {
    records.push(value)
    const rows = records.filter((r): r is Awaited<ReturnType<typeof evaluate>> & { workload: { kind: string; count: number }; passed: boolean } =>
      typeof r === 'object' && r !== null && 'workload' in r)
    const ms = (v: number): string => `${v.toFixed(1)} ms`
    report.innerHTML = rows.length
      ? `<table><thead><tr><th>Graph</th><th>Points</th><th>Frame p95</th><th>Within 33 ms</th>
      <th>Paused pick max</th><th>Running pick max</th><th>Pixel failures</th><th>Local gates</th></tr></thead><tbody>${rows.map(r =>
    `<tr><td>${r.workload.kind}</td><td>${r.workload.count.toLocaleString()}</td><td>${ms(r.frames.p95)}</td>
      <td>${(r.within33 * 100).toFixed(1)}%</td><td>${ms(r.interactions.pick.max)}</td><td>${ms(r.interactions.activePick.max)}</td>
      <td>${r.validation.interiorIdFailures + r.validation.interiorColorFailures + r.validation.invisiblePicks}</td>
      <td>${r.passed ? 'Pass within sampled scope' : 'Not accepted'}</td></tr>`).join('')}</tbody></table>
      <p>All observations remain in Export JSON. These local rows do not establish strict compatibility or full migration readiness.</p>`
      : ''
    if (rows.length) {
      report.insertAdjacentHTML('beforeend', `<table><caption>Layout quality · measured only, no pass threshold</caption>
        <thead><tr><th>Graph</th><th>Stress at 60 → 360</th><th>Overlapping circle pairs at 360</th>
        <th>Residual motion, world units at 361</th></tr></thead><tbody>${rows.map(r => `<tr>
        <td>${r.workload.kind} ${r.workload.count}</td><td>${r.quality.warmup.stressRms?.toFixed(3)} → ${r.quality.end.stressRms?.toFixed(3)}</td>
        <td>${r.quality.end.overlapPairs.toLocaleString()}</td><td>${r.quality.residual.motionRms.toFixed(4)}</td></tr>`).join('')}</tbody></table>`)
    }
    const pacing = records.filter((r): r is PacingRow => typeof r === 'object' && r !== null && 'pacing' in r)
    if (pacing.length) {
      report.insertAdjacentHTML('beforeend', `<table><caption>Pacing controls · wall-clock components, not GPU timestamps</caption>
        <thead><tr><th>Repeat / control</th><th>Frame p95</th><th>Within 33 ms</th><th>Encode simulation p95</th>
        <th>Encode draw p95</th><th>Completion wait p95</th><th>Next frame wait p95</th><th>Pick max paused / running</th><th>Local gates</th></tr></thead>
        <tbody>${pacing.map(r => `<tr><td>${r.fixture} ${r.pointCount} · ${r.repetition} · ${r.mode}</td><td>${ms(r.frames.p95)}</td>
        <td>${(r.within33 * 100).toFixed(1)}%</td><td>${ms(r.stages.encodeSimulationMs.p95)}</td><td>${ms(r.stages.encodeDrawMs.p95)}</td>
        <td>${ms(r.stages.completionWaitMs.p95)}</td><td>${ms(r.stages.nextFrameWaitMs.p95)}</td>
        <td>${r.interactions ? `${ms(r.interactions.pick.max)} / ${ms(r.interactions.activePick.max)}` : 'Unchecked'}</td>
        <td>${pacingVerdict(r)}</td></tr>`).join('')}</tbody></table>
        <p>Controls describe scheduling, not migration acceptance. Full-tick targets remain unchanged.
        Completion wait includes GPU work and delivery of its completion notification. Export includes per-pick phases and raw samples.</p>`)
    }
    const gpuRows = records.filter((r): r is GpuTimingRow => typeof r === 'object' && r !== null && 'gpuTiming' in r)
    if (gpuRows.length) {
      const duration = (values: number[] | null): string => values ? `${percentiles(values).p95.toFixed(3)} ms` : 'Not measured'
      report.insertAdjacentHTML('beforeend', `<table><caption>Actual GPU pass durations · p95 milliseconds</caption>
        <thead><tr><th>Graph / window / timestamps</th><th>Simulation GPU</th><th>Drawing GPU</th><th>GPU sum</th>
        <th>Completion wait</th><th>Frame interval</th><th>Within 33 ms</th>
        <th>Pick max paused / running</th><th>State bits</th><th>Local gates</th></tr></thead>
        <tbody>${gpuRows.map(r => `<tr><td>${r.fixture} · ${r.pointCount.toLocaleString()} · ${r.springOptimization} ·
        ${r.window} · ${r.instrumented ? r.gpu.status : 'off'}</td>
        <td>${duration(r.gpu.simulationMs)}</td><td>${duration(r.gpu.drawingMs)}</td><td>${duration(r.gpu.totalMs)}</td>
        <td>${ms(r.completionWait.p95)}</td><td>${ms(r.frames.p95)}</td><td>${(r.within33 * 100).toFixed(1)}%</td>
        <td>${ms(r.interactions.pick.max)} / ${ms(r.interactions.activePick.max)}</td>
        <td>${r.window === 1 ? 'Baseline' : r.sameState.positions && r.sameState.forces && r.sameState.colors !== false ? 'Match' : 'Mismatch'}</td>
        <td>${gpuTimingVerdict(r)}</td></tr>`).join('')}</tbody></table>
        <p>GPU sum adds compute and render duration within each frame. It excludes gaps between passes, CPU work and presentation.
        Independent p95 columns cannot be subtracted to infer notification latency. Export retains per-frame values and picking checks.</p>`)
    }
    const profiles = records.filter((r): r is StarProfileRow => typeof r === 'object' && r !== null && 'starProfile' in r)
    if (profiles.length) {
      report.insertAdjacentHTML('beforeend', `<table><caption>Star stage diagnostics · changed pass boundaries, not acceptance timing</caption>
        <thead><tr><th>Window / mode</th><th>Stage</th><th>GPU median</th><th>GPU p95</th><th>State / color bits</th></tr></thead>
        <tbody>${profiles.flatMap(r => r.stages.map(s => `<tr><td>${r.window} · ${r.mode}</td><td>${s.name}</td>
        <td>${s.samples ? ms(percentiles(s.samples).median) : r.timerStatus}</td><td>${s.samples ? ms(percentiles(s.samples).p95) : r.timerStatus}</td>
        <td>${Object.values(r.sameState).every(Boolean) ? 'Match' : 'Mismatch'}</td></tr>`)).join('')}</tbody></table>`)
    }
    if (!rows.length && !pacing.length && !gpuRows.length && !profiles.length) {
      const paragraph = document.createElement('p'); paragraph.textContent = JSON.stringify(value, null, 2); report.append(paragraph)
    }
  }
  const action = async (name: string): Promise<void> => {
    if (name === 'cancel') { cancelled = true; runtime.pause(); return }
    if (busy) return
    busy = true; cancelled = false; failure = ''; update()
    try {
      if (name === 'run') runtime.resume()
      if (name === 'pause') runtime.pause()
      if (name === 'step') await runtime.step()
      if (name === 'replace') await runtime.replace(kind.value as Workload, Number(count.value))
      if (name === 'fit') { runtime.pause(); fit(runtime, (await runtime.backend.read()).positions); await runtime.frame(false) }
      if (name === 'check') {
        runtime.pause(); const interactions = await interactionCheck(runtime); const validation = await validateFrame(runtime)
        show({ interactions, validation }); checks = 'Interaction and sampled pixels checked; inspect counts below'
      }
      if (name === 'gpu-timing' || name === 'gpu-large' || name === 'hub-compare') {
        runtime.pause(); canvas.scrollIntoView({ block: 'center' })
        const inputs = name === 'hub-compare'
          ? (['star', 'chain', 'communities'] as const).map(kind => ({ kind, count: 8192, hubComparison: true }))
          : name === 'gpu-large' ? gpuLargeMatrix : [{ kind: kind.value as Workload, count: Number(count.value) }]
        for (const input of inputs) {
          if (cancelled || destroyed) break
          kind.value = input.kind; count.value = String(input.count)
          await profileGpuTiming(runtime, () => cancelled || destroyed, text => { status.textContent = text }, row => {
            show(row); checks = `${row.fixture} ${row.pointCount} · GPU timing ${row.window}: ${gpuTimingVerdict(row)}; inspect retained rows`
            if (gpuTimingVerdict(row) === 'Not accepted') failure = 'A GPU timing window missed the existing local gates or state check'
          }, input)
        }
      }
      if (name === 'pacing' || name === 'star-pacing') {
        kind.value = name === 'star-pacing' ? 'star' : 'communities'; count.value = name === 'star-pacing' ? '8192' : '1024'
        runtime.pause(); canvas.scrollIntoView({ block: 'center' })
        await profilePacing(runtime, () => cancelled || destroyed, text => { status.textContent = text }, row => {
          show(row); checks = `${row.mode}: ${pacingVerdict(row)}; inspect retained rows`
          if (pacingVerdict(row) === 'Not accepted') failure = 'A full-tick pacing row missed the existing local gates'
        }, { kind: kind.value as Workload, count: Number(count.value) })
      }
      if (name === 'star-stages') {
        kind.value = 'star'; count.value = '8192'; runtime.pause(); canvas.scrollIntoView({ block: 'center' })
        await profileStarStages(runtime, () => cancelled || destroyed, text => { status.textContent = text }, row => {
          show(row); checks = `Stage diagnostic ${row.window}; not a normal-frame acceptance run`
          const v = row.validation
          if (row.timerStatus !== 'valid' || !Object.values(row.sameState).every(Boolean) || !v.finite ||
            !v.paintedSamples || v.interiorIdFailures || v.interiorColorFailures || v.invisiblePicks) {
            failure = 'Stage diagnostic failed; inspect retained evidence'
          }
        })
      }
      if (name === 'measure' || name === 'matrix') {
        runtime.pause(); runtime.resize(960, 600, devicePixelRatio); canvas.scrollIntoView({ block: 'center' })
        const inputs = name === 'matrix' ? matrix : [{ kind: kind.value as Workload, count: Number(count.value) }]
        // This preflight is deliberately before every 8,192-point matrix evaluation.
        if (name === 'matrix') {
          await runtime.replace('chain', 1024); const preflight = await interactionCheck(runtime); show({ preflight })
          if (!preflight.exactIds || !preflight.dragPinned || !preflight.pause || !preflight.resize) {
            throw new Error('Initial 1,024-point interaction gate failed; scaling blocked')
          }
        }
        for (const input of inputs) {
          if (cancelled || destroyed) break
          await runtime.replace(input.kind, input.count)
          const result = await evaluate(runtime, () => cancelled || destroyed, text => { status.textContent = `${input.kind} ${input.count}: ${text}` })
          const v = result.validation; const i = result.interactions
          const passed = result.within33 >= 0.95 && i.pick.max <= 50 && i.activePick.max <= 50 && i.drag.max <= 50 &&
            i.exactIds && i.dragPinned && i.pause && i.resume && i.resize &&
            v.finite && v.interiorIdFailures === 0 && v.interiorColorFailures === 0 && v.invisiblePicks === 0 && v.paintedSamples > 0
          show({ workload: input, links: workload(input.kind, input.count).graph.links.length / 2, passed, ...result })
          checks = `${records.length} records retained; latest ${input.kind}: ${passed ? 'Pass within sampled scope' : 'Not accepted'}`
        }
      }
      if (name === 'export') {
        const content = JSON.stringify({
          protocol, pacingProtocol, gpuTimingProtocol, starProfileProtocol, hubComparisonProtocol, recordedAt: new Date().toISOString(), records,
        }, null, 2)
        const blob = new Blob([content], { type: 'application/json' })
        const url = URL.createObjectURL(blob); const link = document.createElement('a')
        link.href = url; link.download = 'integrated-webgpu-local.json'; link.click(); URL.revokeObjectURL(url)
      }
    } catch (e) { failure = String(e); status.textContent = failure } finally { busy = false; if (!destroyed) update() }
  }
  const abort = new AbortController()
  host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    button.addEventListener('click', () => { action(button.dataset.action!) }, { signal: abort.signal })
  })
  const timer = setInterval(update, 500); update()
  return {
    pause: (): void => { cancelled = true; runtime.pause() },
    destroy: (): void => {
      destroyed = true; cancelled = true; clearInterval(timer); abort.abort(); runtime.destroy(); disposeRunLayout(host)
    },
  }
}
