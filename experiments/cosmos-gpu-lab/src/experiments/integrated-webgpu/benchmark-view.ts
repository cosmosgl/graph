import { gpuTimingProtocol, hubComparisonProtocol, gpuLargeMatrix, profileGpuTiming, gpuTimingVerdict, type GpuTimingRow } from './gpu-timing'
import type { Integrated } from './runtime'
import { matrix, type Workload } from './data'
import { evaluate, interactionCheck, protocol, percentiles } from './evaluate'
import { pacingProtocol, profilePacing, pacingVerdict, type PacingRow } from './pacing'
import { settledProtocol, assessSettled, settledVerdict, type SettledRow } from './settled'
import { starProfileProtocol, profileStarStages, type StarProfileRow } from './star-profile'
import { pickReplayProtocol, parseCooledCapture, replayCooledPicking, pickReplayVerdict, replaySummary, type PickReplayRow } from './pick-replay'
import { validateFrame } from './validation'

export const primaryControls = `<section data-run-part="configuration" id="benchmark-controls">
  <div class="controls"><button class="button-primary" data-action="measure">Measure this graph</button>
  <button data-action="matrix">Evaluate declared matrix</button></div>
  <p>Keep the tab visible for 60 warmup ticks and 300 measured frames. At least 95% of frames must finish within 33 ms.
  Picking and dragging each have a 50 ms maximum.</p>
  <p data-device></p>
  <div class="controls"><button data-action="cancel" hidden>Cancel evaluation</button><button data-action="export" hidden>Export JSON</button></div>
  <p role="status">Preparing graph…</p>
  </section>`

export const benchmarkControls = `<section data-run-part="metrics">
  <div id="run-results" data-results="measure matrix"></div>
  <h3>Interaction and pixels</h3><button data-action="check">Check interaction + pixels</button><div data-results="check"></div>
  <h3>Frame pacing</h3><div class="controls"><button data-action="pacing">Profile small-graph pacing</button>
  <button data-action="star-pacing">Profile star pacing</button></div><div data-results="pacing star-pacing"></div>
  <h3>GPU timing and star profiling</h3><div class="controls"><button data-action="gpu-timing">Compare GPU timestamps</button>
  <button data-action="gpu-large">Time 8,192-point graphs</button><button data-action="star-stages">Profile star stages</button>
  <button data-action="hub-compare">Compare hub prefetch</button></div><div data-results="gpu-timing gpu-large star-stages hub-compare"></div>
  <h3>Cooled Karate picking</h3><label>Study <select data-karate-study><option value="settled">Settled assessment</option>
  <option value="pick-replay">Replay cooled picking</option></select></label>
  <div data-replay-input hidden><label>Earlier JSON export <input type="file" accept=".json,application/json" data-cooled-capture></label>
  <p>Leave the file empty to use this session’s settled assessment.</p></div>
  <button data-action="settled">Assess settled Karate Club</button><button data-action="pick-replay" hidden>Replay cooled picking</button>
  <button data-action="fit" hidden>Fit cooled graph</button>
  <div data-results="settled pick-replay"></div></section>`
export function createBenchmarks (
  host: HTMLElement, runtime: Integrated, kind: HTMLSelectElement, count: HTMLSelectElement, selectedCount: () => number
): { update(busy: boolean): void; cancel(): void; run(name: string): Promise<void> } {
  const { canvas } = runtime
  host.querySelector<HTMLElement>('[data-device]')!.textContent = `Device · ${runtime.deviceLabel}`
  const study = host.querySelector<HTMLSelectElement>('[data-karate-study]')!
  const replayInput = host.querySelector<HTMLElement>('[data-replay-input]')!
  const button = (action: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!
  study.onchange = (): void => {
    const replay = study.value === 'pick-replay'
    replayInput.hidden = !replay
    button('settled').hidden = replay
    button('pick-replay').hidden = !replay
  }
  const status = host.querySelector<HTMLElement>('[role=status]')!
  let cancelled = false; let measuring = false
  const records: unknown[] = []
  let cooledGraph: Integrated['data'] | undefined
  let replayFeedbackStart: number | undefined
  const captureFile = host.querySelector<HTMLInputElement>('[data-cooled-capture]')!
  const render = (report: HTMLElement, results: unknown[]): void => {
    const rows = results.filter((r): r is Awaited<ReturnType<typeof evaluate>> & { workload: { kind: string; count: number }; passed: boolean } =>
      typeof r === 'object' && r !== null && 'workload' in r)
    const ms = (v: number): string => `${v.toFixed(1)} ms`
    report.innerHTML = rows.length
      ? `<table><thead><tr><th>Graph</th><th>Points</th><th>Frame p95</th><th>Within 33 ms</th>
      <th>Paused pick max</th><th>Running pick max</th><th>Pixel failures</th><th>Local gates</th></tr></thead><tbody>${rows.map(r =>
    `<tr><td>${r.workload.kind}</td><td>${r.workload.count.toLocaleString()}</td><td>${ms(r.frames.p95)}</td>
      <td>${(r.within33 * 100).toFixed(1)}%</td><td>${ms(r.interactions.pick.max)}</td><td>${ms(r.interactions.activePick.max)}</td>
      <td>${r.validation.interiorIdFailures + r.validation.interiorColorFailures + r.validation.invisiblePicks}</td>
      <td>${r.passed ? 'Pass within sampled scope' : 'Not accepted'}</td></tr>`).join('')}</tbody></table>`
      : ''
    if (rows.length) {
      report.insertAdjacentHTML('beforeend', `<table><caption>Layout quality · measured only, no pass threshold</caption>
        <thead><tr><th>Graph</th><th>Stress at 60 → 360</th><th>Overlapping circle pairs at 360</th>
        <th>Residual motion, world units at 361</th></tr></thead><tbody>${rows.map(r => `<tr>
        <td>${r.workload.kind} ${r.workload.count}</td><td>${r.quality.warmup.stressRms?.toFixed(3)} → ${r.quality.end.stressRms?.toFixed(3)}</td>
        <td>${r.quality.end.overlapPairs.toLocaleString()}</td><td>${r.quality.residual.motionRms.toFixed(4)}</td></tr>`).join('')}</tbody></table>`)
    }
    const pacing = results.filter((r): r is PacingRow => typeof r === 'object' && r !== null && 'pacing' in r)
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
    const gpuRows = results.filter((r): r is GpuTimingRow => typeof r === 'object' && r !== null && 'gpuTiming' in r)
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
    const profiles = results.filter((r): r is StarProfileRow => typeof r === 'object' && r !== null && 'starProfile' in r)
    if (profiles.length) {
      for (const row of profiles) {
        const v = row.validation
        const valid = row.timerStatus === 'valid' && Object.values(row.sameState).every(Boolean) && v.finite &&
          v.paintedSamples > 0 && !v.interiorIdFailures && !v.interiorColorFailures && !v.invisiblePicks
        report.insertAdjacentHTML('beforeend', `<p>Window ${row.window} · ${row.mode} · diagnostic checks ${valid ? 'passed' : 'failed'}.</p>`)
      }
      report.insertAdjacentHTML('beforeend', `<table><caption>Star stage diagnostics · changed pass boundaries, not acceptance timing</caption>
        <thead><tr><th>Window / mode</th><th>Stage</th><th>GPU median</th><th>GPU p95</th><th>State / color bits</th></tr></thead>
        <tbody>${profiles.flatMap(r => r.stages.map(s => `<tr><td>${r.window} · ${r.mode}</td><td>${s.name}</td>
        <td>${s.samples ? ms(percentiles(s.samples).median) : r.timerStatus}</td><td>${s.samples ? ms(percentiles(s.samples).p95) : r.timerStatus}</td>
        <td>${Object.values(r.sameState).every(Boolean) ? 'Match' : 'Mismatch'}</td></tr>`)).join('')}</tbody></table>`)
    }
    const settled = results.filter((r): r is SettledRow => typeof r === 'object' && r !== null && 'settled' in r)
    for (const r of settled) {
      const i = r.interactions; const functional = i.exactIds && i.dragPinned && i.pause && i.resume && i.resize
      report.insertAdjacentHTML('beforeend', `<h3>Settled Karate Club · ${settledVerdict(r)}</h3>
        <p>Visible point IDs: ${r.inventory.visibleIds.length}/34; missing: ${r.inventory.missingIds.join(', ') || 'none'}.
        Every visible ID picked correctly: ${r.inventory.exactIds ? 'Yes' : 'No'}; worst feedback ${ms(r.inventory.pick.max)}.</p>
        <table><caption>Complete frame intervals</caption><thead><tr><th>Ticks</th><th>Frame p95</th><th>Within 33 ms</th></tr></thead>
        <tbody>${r.windows.map(w => `<tr><td>${w.from}–${w.to}</td><td>${ms(w.frames.p95)}</td>
        <td>${(w.within33 * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>
        <table><caption>Geometry · measured only, no quality threshold</caption><thead><tr><th>Tick / framing</th><th>Stress</th>
        <th>Overlapping pairs</th><th>Visible centers</th><th>Radius, world units</th></tr></thead><tbody>${r.checkpoints.map(q => `<tr>
        <td>${q.tick} · ${q.fitted ? 'Fit' : 'held camera'}</td><td>${q.stressRms?.toFixed(3)}</td><td>${q.overlapPairs}</td>
        <td>${q.visiblePoints}/34</td><td>${q.radius.toFixed(2)}</td></tr>`).join('')}</tbody></table>
        <p>Residual motion after tick 5,300: ${r.residual.motionRms.toExponential(3)} world units per tick.
        Cooling reduces force strength; low motion does not establish useful geometry.</p>
        <p>Existing interaction checks: ${functional ? 'Pass' : 'Fail'}.
        Worst paused / running pick: ${ms(r.interactions.pick.max)} / ${ms(r.interactions.activePick.max)}; drag: ${ms(r.interactions.drag.max)}.</p>
        <table><caption>Rendering audits · original boundary and color rules</caption><thead><tr><th>View</th><th>Samples</th>
        <th>Interior ID / color failures</th>
        <th>Invisible picks</th></tr></thead><tbody>${r.audits.map(a => `<tr><td>${a.view}</td><td>${a.validation.samples}</td>
        <td>${a.validation.interiorIdFailures} / ${a.validation.interiorColorFailures}</td>
        <td>${a.validation.invisiblePicks}</td></tr>`).join('')}</tbody></table>`)
    }
    const replays = results.filter((r): r is PickReplayRow => typeof r === 'object' && r !== null && 'pickReplay' in r)
    for (const r of replays) {
      const v = r.validation
      const pixels = v
        ? `${v.samples} pixels; ${v.interiorIdFailures} interior ID failures, ${v.interiorColorFailures} color failures, ${v.invisiblePicks} invisible picks`
        : 'Unchecked'
      report.insertAdjacentHTML('beforeend', `<h3>Cooled picking replay · ${pickReplayVerdict(r)}</h3>
        <p>Frozen imported geometry, source tick 5,300. Runtime tick is reset; this is not continued cooling.
        ${r.samples.length}/102 requests; missing IDs: ${r.missingIds.join(', ') || 'none'};
        exact IDs: ${!r.samples.length ? 'Unchecked' : r.samples.every(s => s.id === s.expectedId) ? 'Yes' : 'No'};
        unchanged positions: ${r.samePositions ? 'Yes' : 'Not confirmed'}.</p>
        <p>Sampled rendering: ${pixels}.</p>
        <table><caption>All requests retained · milliseconds; phases belong to each sweep’s worst request</caption>
        <thead><tr><th>Sweep / requests</th><th>First</th><th>p95</th><th>Worst / ID</th><th>ID readback</th>
        <th>Highlight completion</th><th>Next frame wait</th></tr></thead><tbody>${replaySummary(r).map(s => `<tr>
        <td>${s.sweep} / ${s.count}</td><td>${ms(s.first)}</td><td>${ms(s.p95)}</td><td>${ms(s.worst.ms)} / ${s.worst.expectedId}</td>
        <td>${ms(s.worst.readMs)}</td><td>${ms(s.worst.highlightMs)}</td><td>${ms(s.worst.opportunityMs)}</td></tr>`).join('')}</tbody></table>
        <p>Historical 68.2-ms failure remains rejected. A successful replay is not a demonstrated fix.
        Raw samples and subsequent feedback are in Export JSON.</p>`)
      if (r.interruption) { const p = document.createElement('p'); p.textContent = r.interruption; report.append(p) }
    }
  }
  return {
    update (busy): void {
      captureFile.disabled = busy; study.disabled = busy
      button('cancel').hidden = !measuring
      button('export').hidden = records.length === 0
      button('fit').hidden = runtime.data !== cooledGraph
    },
    cancel (): void { cancelled = true },
    async run (name: string): Promise<void> {
      cancelled = false
      const output = host.querySelector<HTMLElement>(`[data-results~="${name}"]`)
      const report = document.createElement('div')
      const results: unknown[] = []
      const show = (value: unknown): void => {
        records.push(value); results.push(value)
        if (!report.parentElement) output?.append(report)
        render(report, results)
      }
      measuring = !!output
      button('cancel').hidden = !measuring
      if (measuring) status.textContent = `${button(name).textContent}…`
      try {
        if (name === 'check') {
          runtime.pause(); const interactions = await interactionCheck(runtime); const validation = await validateFrame(runtime)
          if (cancelled) throw new Error('Check cancelled')
          const fixture = runtime.data.kind; const points = runtime.data.input.points.length / 4; const links = runtime.data.graph.links.length / 2
          records.push({ fixture, points, links, interactions, validation })
          const i = interactions; const v = validation
          const outcome = (ok: boolean): string => ok ? 'pass' : 'fail'
          report.innerHTML = `<h4>${fixture} · ${points.toLocaleString()} points · ${links.toLocaleString()} links</h4>
            <p>Point IDs and camera anchoring: ${outcome(i.exactIds)} · Drag pin: ${outcome(i.dragPinned)} · Pause: ${outcome(i.pause)}
            · Resume: ${outcome(i.resume)} · Resize: ${outcome(i.resize)}</p>
            <p>Maximum feedback: paused pick ${i.pick.max.toFixed(1)} ms · running pick ${i.activePick.max.toFixed(1)} ms
            · drag ${i.drag.max.toFixed(1)} ms.</p>
            <p>${v.samples} sampled pixels · ${v.paintedSamples} painted · finite coordinates: ${outcome(v.finite)}.
            Interior ID errors: ${v.interiorIdFailures} · color errors: ${v.interiorColorFailures} · invisible picks: ${v.invisiblePicks}.</p>`
          output!.append(report)
        }
        if (name === 'gpu-timing' || name === 'gpu-large' || name === 'hub-compare') {
          runtime.pause(); canvas.scrollIntoView({ block: 'center' })
          const inputs = name === 'hub-compare'
            ? (['star', 'chain', 'communities'] as const).map(kind => ({ kind, count: 8192, hubComparison: true }))
            : name === 'gpu-large' ? gpuLargeMatrix : [{ kind: kind.value as Workload, count: selectedCount() }]
          for (const input of inputs) {
            if (cancelled) break
            kind.value = input.kind; if (input.kind !== 'karate') count.value = String(input.count)
            await profileGpuTiming(runtime, () => cancelled, text => { status.textContent = text }, show, input)
          }
        }
        if (name === 'pacing' || name === 'star-pacing') {
          kind.value = name === 'star-pacing' ? 'star' : 'communities'; count.value = name === 'star-pacing' ? '8192' : '1024'
          runtime.pause(); canvas.scrollIntoView({ block: 'center' })
          await profilePacing(runtime, () => cancelled, text => { status.textContent = text }, show, { kind: kind.value as Workload, count: selectedCount() })
        }
        if (name === 'star-stages') {
          kind.value = 'star'; count.value = '8192'; runtime.pause(); canvas.scrollIntoView({ block: 'center' })
          await profileStarStages(runtime, () => cancelled, text => { status.textContent = text }, show)
        }
        if (name === 'pick-replay') {
          const file = captureFile.files?.[0]
          if (file && file.size > 10 * 1024 * 1024) throw new Error('Choose a capture smaller than 10 MB')
          const source = parseCooledCapture(file ? await file.text() : JSON.stringify({ records }))
          kind.value = 'karate'; runtime.pause(); canvas.scrollIntoView({ block: 'center' })
          status.textContent = 'Replaying three paused picking sweeps on retained tick-5300 geometry'
          const result = await replayCooledPicking(runtime, source, () => cancelled)
          cooledGraph = runtime.data
          show(result); replayFeedbackStart = runtime.feedback.length
        }
        if (name === 'settled') {
          kind.value = 'karate'; runtime.pause(); canvas.scrollIntoView({ block: 'center' })
          const result = await assessSettled(runtime, () => cancelled, text => { status.textContent = text })
          cooledGraph = runtime.data
          show(result)
        }
        if (name === 'measure' || name === 'matrix') {
          runtime.pause(); runtime.resize(960, 600, devicePixelRatio); canvas.scrollIntoView({ block: 'center' })
          const inputs = name === 'matrix' ? matrix : [{ kind: kind.value as Workload, count: selectedCount() }]
          // This preflight is deliberately before every 8,192-point matrix evaluation.
          if (name === 'matrix') {
            await runtime.replace('chain', 1024); const preflight = await interactionCheck(runtime); records.push({ preflight })
            if (!preflight.exactIds || !preflight.dragPinned || !preflight.pause || !preflight.resize) {
              throw new Error('Initial 1,024-point interaction gate failed; scaling blocked')
            }
          }
          for (const input of inputs) {
            if (cancelled) break
            await runtime.replace(input.kind, input.count)
            const result = await evaluate(runtime, () => cancelled, text => { status.textContent = `${input.kind} ${input.count}: ${text}` })
            const v = result.validation; const i = result.interactions
            const passed = result.within33 >= 0.95 && i.pick.max <= 50 && i.activePick.max <= 50 && i.drag.max <= 50 &&
              i.exactIds && i.dragPinned && i.pause && i.resume && i.resize &&
              v.finite && v.interiorIdFailures === 0 && v.interiorColorFailures === 0 && v.invisiblePicks === 0 && v.paintedSamples > 0
            show({ passed, ...result })
          }
        }
        if (name === 'export') {
          const content = JSON.stringify({
            protocol,
            pacingProtocol,
            gpuTimingProtocol,
            starProfileProtocol,
            hubComparisonProtocol,
            settledProtocol,
            pickReplayProtocol,
            feedbackAfterReplay: replayFeedbackStart === undefined ? [] : runtime.feedback.slice(replayFeedbackStart),
            recordedAt: new Date().toISOString(),
            info: runtime.info,
            records,
          }, null, 2)
          const blob = new Blob([content], { type: 'application/json' })
          const url = URL.createObjectURL(blob); const link = document.createElement('a')
          link.href = url; link.download = 'integrated-webgpu-local.json'; link.click(); URL.revokeObjectURL(url)
        }
      } finally {
        measuring = false
        kind.value = runtime.data.kind
        if (kind.value !== 'karate') count.value = String(runtime.data.input.points.length / 4)
      }
    },
  }
}
