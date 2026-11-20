import type { ExperimentInstance } from '../../runtime/experiment'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import { compactRunControls } from '../../runtime/compact-controls'
import { graphRgba } from '../../runtime/palette'
import { createIntegrated } from '../integrated-webgpu/runtime'
import { evaluate } from '../integrated-webgpu/evaluate'
import { fit, validateFrame } from '../integrated-webgpu/validation'
import { assessmentChecks, pixelCheck, protocol, type Check } from './checks'
import { member, pointSize } from './members'
import { investigateLatency, latencyProtocol, type LatencyBlock } from './latency'
export async function createView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div class="controls">
    <button class="button-primary" data-action="run" data-run-action="primary">Run</button>
    <button data-action="pause" data-run-action="primary">Pause</button>
    <button data-action="fit" data-run-action="primary">Fit graph</button>
    <button data-action="reset" data-run-action="primary">Reset Karate Club</button></div>
    <p data-run-part="status" role="status">Loading the Karate Club graph…</p>
    <section data-run-part="visualization"><canvas aria-label="Karate Club WebGPU graph" width="960" height="540"
      style="width:100%;aspect-ratio:16/9;display:block;touch-action:none"></canvas>
      <p data-selection>Choose a circle or locate a member.</p>
      <p>34 members · 78 weighted links. Click a member to inspect; drag to move it. Drag empty space to pan; scroll to zoom.</p>
      <p data-input>Native picking: unchecked.</p></section>
    <section data-run-part="configuration"><div class="controls">
      <label>Member ID <input data-member type="number" min="0" max="33" step="1" value="0" style="width:5rem"></label>
      <button data-action="locate">Locate member</button>
      <label><input type="checkbox" data-degree> Size circles by degree</label></div>
      <p>IDs 0–33 come from the dataset. Degree is the number of neighbors; edge weights are shown as total connection weight.</p>
      <p data-member-message></p><section aria-label="Selected member neighbors"><h3>Neighbors</h3>
      <div data-neighbors style="display:flex;flex-wrap:wrap;gap:8px"></div>
      <p>Neighbor buttons locate a member; they are not GPU picking checks.</p></section></section>
    <section data-run-part="results"><div data-report>No checks run in this session.</div></section>
    <section data-run-part="diagnostics"><div class="controls"><button data-action="assess">Assess this pilot</button>
      <button data-action="latency">Investigate picking latency</button>
      <button data-action="pixels">Check current pixels</button><button data-action="cancel">Cancel assessment</button>
      <button data-action="export">Export JSON</button></div>
      <p>Assessment resets the graph. Timing and pixel checks are reported separately from exploration.</p></section>`
  const canvas = host.querySelector('canvas')!; const status = host.querySelector<HTMLElement>('[role=status]')!
  const input = host.querySelector<HTMLInputElement>('[data-member]')!; const degree = host.querySelector<HTMLInputElement>('[data-degree]')!
  const message = host.querySelector<HTMLElement>('[data-member-message]')!; const rows: Check[] = []; const captures: unknown[] = []
  const latencyRuns: Array<{ startedAt: string; protocol: string; blocks: LatencyBlock[] }> = []
  let busy = false; let dead = false; let cancelled = false; let failure = ''; let displayed = -2
  host.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true })
  const r = await createIntegrated(canvas, 'karate', 34)
  try {
    const width = Math.round(canvas.getBoundingClientRect().width)
    r.resize(width, Math.round(width * 9 / 16), devicePixelRatio); fit(r, (await r.backend.read()).positions); await r.frame(false)
  } catch (e) { r.destroy(); throw e }
  mountRunLayout(host, () => ({
    state: busy ? 'Assessing' : r.running ? 'Running' : 'Paused',
    passed: `${rows.filter(row => row.pass).length} named checks`,
    failed: failure || r.error || `${rows.filter(row => !row.pass).length} failed checks`,
    unchecked: 'Larger graphs and feedback outside the named checks.',
  }), { experiment: 'pilot-viewer', fixedOrder: true, devices: () => [r.info] })
  compactRunControls(host, { diagnostics: true })
  host.querySelector<HTMLElement>('.run-workbench')!.style.display = 'block'
  const record = (checks: Check[], capture: unknown): void => {
    rows.push(...checks); captures.push(capture)
    const table = document.createElement('table'); table.innerHTML = '<thead><tr><th>Check</th><th>Result</th><th>Scope</th></tr></thead>'
    const body = document.createElement('tbody')
    for (const check of rows) {
      const tr = document.createElement('tr')
      for (const text of [check.name, check.pass ? 'Pass' : 'Fail', check.detail]) {
        const td = document.createElement('td'); td.textContent = text; tr.append(td)
      }
      body.append(tr)
    }
    table.append(body); host.querySelector('[data-report]')!.replaceChildren(table)
  }
  const style = (): void => {
    for (let id = 0; id < 34; id++) r.renderer.setStyle(id, graphRgba.point, pointSize(id, degree.checked))
  }
  const reset = async (): Promise<void> => {
    await r.replace('karate', 34); degree.checked = false; style(); fit(r, (await r.backend.read()).positions); await r.frame(false)
    displayed = -2; message.textContent = ''; input.value = '0'
  }
  const locate = async (id: number): Promise<void> => {
    member(id) // Reject invalid input before reading or mutating the viewer.
    const positions = (await r.backend.read()).positions
    r.renderer.camera.x = positions[id * 4]; r.renderer.camera.y = positions[id * 4 + 1]
    r.renderer.selected = id; input.value = String(id); await r.frame(false)
    message.textContent = `Located member ${id}. This uses its ID directly, not a GPU pick.`
    canvas.scrollIntoView({ block: 'center' })
    captures.push({ action: 'locate', id, tick: r.tick })
  }
  const update = (): void => {
    if (dead) return
    host.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = busy && b.dataset.action !== 'cancel' })
    input.disabled = degree.disabled = busy; canvas.style.pointerEvents = busy ? 'none' : 'auto'
    if (!busy) {
      status.textContent = failure || r.error || `${r.running ? 'Running' : 'Paused'} · tick ${r.tick} · ` +
      `${degree.checked ? 'degree sizes' : 'uniform sizes'}`
    }
    const feedback = r.feedback.at(-1)
    host.querySelector<HTMLElement>('[data-input]')!.textContent = feedback
      ? `Latest GPU pick: ${feedback.id === null ? 'background' : `member ${feedback.id}`} · ` +
        `${feedback.ms.toFixed(1)} ms feedback · ${r.feedback.length} requests (includes diagnostic picks)`
      : 'Native picking: unchecked.'
    if (displayed !== r.renderer.selected) {
      displayed = r.renderer.selected
      const neighbors = host.querySelector<HTMLElement>('[data-neighbors]')!; neighbors.replaceChildren()
      const selection = host.querySelector<HTMLElement>('[data-selection]')!
      if (displayed < 0) selection.textContent = 'Choose a circle or locate a member.'
      else {
        const data = member(displayed)
        selection.textContent = `Member ${data.id} · ${data.neighbors.length} neighbors · total connection weight ${data.strength}`
        for (const id of data.neighbors) {
          const button = document.createElement('button'); button.dataset.neighbor = String(id)
          button.textContent = `Member ${id}`; button.disabled = busy; neighbors.append(button)
        }
      }
    }
  }
  const act = async (action: string, neighbor?: number): Promise<void> => {
    if (action === 'cancel') { cancelled = true; return }
    if (busy || dead) return
    const wasRunning = r.running; r.pause(); busy = true; cancelled = false; failure = ''; update()
    let resume = wasRunning
    try {
      await r.frame(false)
      if (action === 'run') resume = true
      if (action === 'pause') resume = false
      if (action === 'fit') { fit(r, (await r.backend.read()).positions); await r.frame(false) }
      if (action === 'locate') {
        if (neighbor === undefined && input.value.trim() === '') throw new Error('Choose a member from 0 to 33')
        await locate(neighbor ?? Number(input.value))
      }
      if (action === 'style') { style(); await r.frame(false) }
      if (action === 'reset') {
        await reset(); captures.push({ action: 'reset', count: r.data.graph.points.length / 4, links: r.data.graph.links.length / 2, running: wasRunning })
      }
      if (action === 'pixels' || action === 'style' || action === 'reset') {
        const pixels = await validateFrame(r); record([pixelCheck(pixels)], { action, pixels, degree: degree.checked, tick: r.tick })
      }
      if (action === 'assess') {
        resume = false; await reset(); const firstFeedback = r.feedback.length
        let hidden = document.visibilityState !== 'visible'
        const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
        document.addEventListener('visibilitychange', visibility)
        try {
          host.querySelector('#run-live-viewer, #run-run')!.scrollIntoView({ block: 'start' })
          const result = await evaluate(r, () => cancelled || dead || hidden, text => { status.textContent = text })
          if (cancelled || dead || hidden) throw new Error('Assessment interrupted; no completed verdict recorded')
          record(assessmentChecks(result), { action: 'assessment', ...result, firstFeedback, lastFeedback: r.feedback.length })
        } finally { document.removeEventListener('visibilitychange', visibility) }
        // The existing interaction probe deliberately perturbs a point; Fit is outside timing.
        fit(r, (await r.backend.read()).positions); await r.frame(false)
      }
      if (action === 'latency') {
        resume = false
        const run = { startedAt: new Date().toISOString(), protocol: latencyProtocol, blocks: [] as LatencyBlock[] }
        latencyRuns.push(run)
        host.querySelector('#run-live-viewer, #run-run')!.scrollIntoView({ block: 'start' })
        await investigateLatency(r, reset, () => cancelled || dead, text => { status.textContent = text }, run.blocks, block => {
          if (dead) return
          const checks = block.checks ?? [{ name: 'Incomplete block', pass: false, detail: block.error ?? 'Not completed' }]
          record(checks.map(check => ({ ...check, name: `Block ${block.index} · ${block.mode} · ${check.name}` })),
            { action: 'latency-block', run: latencyRuns.length, block: block.index, state: block.state })
        })
        fit(r, (await r.backend.read()).positions); await r.frame(false)
      }
      if (action === 'export') {
        const rect = canvas.getBoundingClientRect()
        const url = URL.createObjectURL(new Blob([JSON.stringify({
          recordedAt: new Date().toISOString(),
          timeOrigin: performance.timeOrigin,
          protocol,
          adapter: r.info,
          logicalViewport: [canvas.width / r.renderer.ratio, canvas.height / r.renderer.ratio, r.renderer.ratio],
          displayedCss: [rect.width, rect.height],
          rows,
          captures,
          latencyRuns,
          feedback: r.feedback,
          strictCompatibility: 'Rejected: retained production color failures',
          fullMigration: 'Not ready',
        }, null, 2)], { type: 'application/json' }))
        const a = document.createElement('a'); a.href = url; a.download = 'karate-pilot-local.json'; a.click(); URL.revokeObjectURL(url)
      }
    } catch (e) {
      failure = String(e); resume = false
      record([{ name: action, pass: false, detail: failure }], { action, error: failure, interrupted: cancelled })
    } finally { busy = false; if (!dead) { if (resume && !cancelled) r.resume(); update() } }
  }
  const abort = new AbortController()
  host.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button[data-action],button[data-neighbor]')
    if (target) act(target.dataset.action ?? 'locate', target.dataset.neighbor === undefined ? undefined : Number(target.dataset.neighbor))
  }, { signal: abort.signal })
  degree.addEventListener('change', () => { act('style') }, { signal: abort.signal })
  try { update() } catch (e) { abort.abort(); disposeRunLayout(host); r.destroy(); throw e }
  const timer = setInterval(update, 100)
  return {
    pause: (): void => { cancelled = true; r.pause() },
    destroy: (): void => { dead = true; cancelled = true; clearInterval(timer); abort.abort(); disposeRunLayout(host); r.destroy() },
  }
}
