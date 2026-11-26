import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import { graphRgba } from '../../runtime/palette'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createIntegrated, nextFrame, type Integrated } from '../integrated-webgpu/runtime'
import { fit, validateFrame } from '../integrated-webgpu/validation'
import { report } from './report'
import type { Production } from './production'
import { styles, type Scene } from './styles'
import { assessViewers, comparePaint, protocol } from './evaluate'

type SavedSession = {
  savedAt: string; gl: string; gpu: string; viewport: number[]; interrupted: boolean;
  records: unknown[]; feedbackHistory: unknown[]; productionFeedback: unknown[];
  productionErrors: string[]; candidateFeedback: unknown[];
}

function clickedPointLabel (id: number | undefined): string {
  return id !== undefined && id >= 0 ? `Clicked point ${id}` : 'No point clicked'
}

export async function createView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div class="controls">
    <button class="button-primary" data-action="run" data-run-action="primary">Run both</button>
    <button data-action="pause" data-run-action="primary">Pause both</button>
    <button data-action="fit" data-run-action="primary">Fit both</button></div>
    <p role="status" data-run-part="status">Loading the WebGL and WebGPU graphs…</p>
    <div data-run-part="visualization" class="viewer-comparison-panels" data-panels>
      <section><h3>Production WebGL · luma v9</h3><div data-webgl style="height:320px;position:relative"></div><p data-gl-status></p></section>
      <section><h3>Candidate WebGPU · luma v10</h3><canvas data-webgpu aria-label="Candidate WebGPU graph"
      style="display:block;height:320px;touch-action:none"></canvas><p data-gpu-status></p></section>
    </div><p class="demo-note" data-run-part="visualization">Click a point to highlight it; drag a point while running. Pan empty space and scroll to zoom.
    Production drag starts from its hover result; move over a point before dragging. Fit is deliberate, not automatic.</p>
    ${typeof Element.prototype.moveBefore === 'function'
    ? ''
    : `<p class="demo-note" data-run-part="visualization" data-restart-note>On this browser, opening a reference restarts the graphs.
    Completed results stay in this tab; export JSON to keep them after closing it.</p>`}
    <section data-run-part="results"><div data-results>No assessment yet.</div><div data-recovered-results></div></section>
    <section data-run-part="diagnostics"><div class="controls">
    <button data-action="style">Toggle style A / B</button><button data-action="chain">Replace with 32-point chain</button>
    <button data-action="karate">Restore Karate Club</button><button data-action="resize">Toggle height 320 / 280</button>
    <button data-action="recreate">Destroy and recreate</button>
    <button data-action="assess">Replay historical frame timing</button>
    <button data-action="paint">Compare same-geometry paint</button><button data-action="paint-layers">Attribute paint differences</button>
    <button data-action="paint-link-smoothing">Test link edge smoothing</button>
    <button data-action="paint-corrected-links">Compare corrected link paint</button>
    <button data-action="check">Check current updates</button>
    <button data-action="cancel">Cancel assessment</button><button data-action="export">Export JSON</button></div>
    <p>Paint checks use the same fixed positions in both panels and replace the current production layout.
    The recorded evidence describes the test conditions and limits.
    <a href="#/viewer-comparison?section=doc-migration-benchmark">Replay the prototype benchmark</a>.</p></section>`
  host.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true })
  const status = host.querySelector<HTMLElement>('[role=status]')!; const results = host.querySelector<HTMLElement>('[data-results]')!
  const glHost = host.querySelector<HTMLDivElement>('[data-webgl]')!; const canvas = host.querySelector<HTMLCanvasElement>('canvas')!
  let gl!: Production; let gpu!: Integrated; let dead = false; let busy = false; let cancelled = false
  let failure = ''; let feedbackErrorCount = 0
  let playing = false; let visible = true; let interacted = false; let pauseGeneration = 0; let raf = 0; let flight = Promise.resolve()
  let scene: Scene = 'karate'; let alternate = false; let height = 320; let ratio = devicePixelRatio
  const records: unknown[] = []; const feedbackHistory: unknown[] = []
  const recovered: SavedSession[] = []
  const interactionAbort = new AbortController()
  const watchInteraction = (element: HTMLElement): void => {
    const mark = (): void => { interacted = true }
    element.addEventListener('pointerdown', mark, { signal: interactionAbort.signal })
    element.addEventListener('wheel', mark, { signal: interactionAbort.signal, passive: true })
  }
  watchInteraction(canvas)
  mountRunLayout(host, () => ({
    state: busy ? 'Evaluating' : playing ? 'Running' : 'Paused',
    passed: `${records.filter(r => report(r).verdict === 'Pass').length} named checks`,
    failed: failure || `${records.filter(r => report(r).verdict === 'Fail').length} failed checks`,
    unchecked: 'Full compatibility and migration readiness',
  }),
  { experiment: 'viewer-comparison', devices: () => [gl?.info, gpu?.info].filter(Boolean) })
  const panel = glHost.parentElement!
  let width = Math.max(1, Math.floor(panel.getBoundingClientRect().width))
  glHost.style.width = `${width}px`; canvas.style.width = `${width}px`
  const resultTable = (rows: unknown[]): HTMLTableElement => {
    const table = document.createElement('table')
    table.innerHTML = '<thead><tr><th>Check</th><th>Result</th><th>Details</th></tr></thead>'
    const body = document.createElement('tbody')
    for (const value of rows) {
      const r = report(value); const row = document.createElement('tr')
      for (const text of [r.name, r.verdict, r.detail]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell) }
      body.append(row)
    }
    table.append(body); return table
  }
  const record = (row: unknown): void => {
    records.push({ ...(row as Record<string, unknown>), viewport: [width, height, ratio] })
    results.replaceChildren(resultTable(records))
  }
  const renderRecovered = (): void => {
    const target = host.querySelector<HTMLElement>('[data-recovered-results]')!
    target.replaceChildren()
    if (!recovered.length) return
    const heading = document.createElement('h3'); heading.textContent = 'Earlier live sessions'; target.append(heading)
    const note = document.createElement('p')
    note.textContent = 'The live comparison restarted. Completed results from earlier sessions are kept in this tab and included in Export JSON. ' +
      'Graph position and playback state are not restored; export the results to keep them after closing the tab.'
    target.append(note)
    for (const session of recovered) {
      const summary = document.createElement('p')
      const interrupted = session.interrupted ? ' · action interrupted; only completed results retained' : ''
      summary.textContent = `Saved ${session.savedAt} · ${session.viewport[0]} × ${session.viewport[1]} CSS px · DPR ${session.viewport[2]}${interrupted}`
      target.append(summary)
      if (session.records.length) target.append(resultTable(session.records))
      else { const empty = document.createElement('p'); empty.textContent = 'No completed checks in this session.'; target.append(empty) }
    }
  }
  const style = (): void => {
    gl.style(alternate); const s = styles(gpu.data.input.points.length / 4, alternate)
    gpu.renderer.selected = -1
    for (let i = 0; i < s.sizes.length; i++) gpu.renderer.setStyle(i, Array.from(s.colors.subarray(i * 4, i * 4 + 4)), s.sizes[i])
    gpu.renderer.setLinkStyle(s.link, s.width)
  }
  const create = async (): Promise<void> => {
    const iframe = document.createElement('iframe')
    iframe.title = 'Production Cosmos WebGL graph'
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block'
    const loaded = new Promise<void>((resolve, reject) => {
      iframe.onload = (): void => resolve(); iframe.onerror = (): void => reject(new Error('Production WebGL frame failed to load'))
    })
    iframe.src = new URL('production-viewer.html', document.baseURI).href
    glHost.replaceChildren(iframe); await loaded
    gl = await (iframe.contentWindow as Window & { cosmosProduction: Promise<Production> }).cosmosProduction
    if (!gl) throw new Error('Production frame did not expose the WebGL graph')
    watchInteraction(gl.canvas)
    try { gpu = await createIntegrated(canvas, 'karate', 34) } catch (e) { gl.destroy(); throw e }
    // Match the production canvas's integer attachment sizing at fractional DPRs.
    gpu.resize(width, height, ratio, 'floor'); fit(gpu, (await gpu.backend.read()).positions); await gpu.frame(false)
  }
  const draw = async (): Promise<void> => { await Promise.all([gl.frame(playing), gpu.frame(playing)]) }
  const stopLoop = (): void => { cancelAnimationFrame(raf); raf = 0 }
  const schedule = (): void => { if (!dead && visible && !busy && !raf) raf = requestAnimationFrame(loop) }
  const loop = (): void => {
    raf = 0
    if (dead || busy || !visible) return
    flight = draw().then(schedule).catch(e => {
      playing = false; failure = String(e); status.textContent = failure
    })
  }
  let viewportQueued = false
  const resize = async (recordDelivery: boolean): Promise<void> => {
    glHost.style.height = `${height}px`; canvas.style.height = `${height}px`
    gpu.resize(width, height, ratio, 'floor')
    const initial = [gl.canvas.width, gl.canvas.height]; let frames = 0
    do {
      await nextFrame()
      if (dead || !visible) { viewportQueued = true; return }
      await gl.frame(false); frames++
      if (frames >= 120) throw new Error('Production resize did not reach the requested attachment dimensions')
    } while (gl.canvas.width !== canvas.width || gl.canvas.height !== canvas.height)
    if (recordDelivery) record({ action: 'resize', initial, settled: [gl.canvas.width, gl.canvas.height], frames })
  }
  const check = async (): Promise<void> => {
    const expected = styles(gpu.data.input.points.length / 4, alternate)
    const glExpected = styles(expected.sizes.length, alternate)
    if (gl.selected !== undefined) { glExpected.colors.set(graphRgba.pinned, gl.selected * 4); glExpected.sizes[gl.selected] += 2 }
    const a = gl.positions(); const b = (await gpu.backend.read()).positions
    record({
      action: 'updates',
      running: playing,
      scene,
      style: alternate ? 'B' : 'A',
      glCount: a.length / 4,
      gpuCount: b.length / 4,
      finite: Array.from(a).every(Number.isFinite) && Array.from(b).every(Number.isFinite),
      glSizes: Array.from(gl.graph.getPointSizes()).every((v, i) => v === glExpected.sizes[i]),
      glColors: Array.from(gl.graph.getPointColors()).every((v, i) => v === glExpected.colors[i]),
      gpuStyles: Array.from(expected.sizes).every((v, i) => gpu.renderer.styles[i * 8 + 4] === v &&
        Array.from(expected.colors.subarray(i * 4, i * 4 + 4)).every((c, k) => gpu.renderer.styles[i * 8 + k] === c)),
      attachments: [[gl.canvas.width, gl.canvas.height], [canvas.width, canvas.height]],
      candidatePixels: await validateFrame(gpu),
    })
  }
  try { await create() } catch (e) { interactionAbort.abort(); disposeRunLayout(host); gl?.destroy(); gpu?.destroy(); throw e }
  const update = (): void => {
    host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b => { b.disabled = busy && b.dataset.action !== 'cancel' })
    glHost.style.pointerEvents = busy ? 'none' : 'auto'; canvas.style.pointerEvents = busy ? 'none' : 'auto'
    if (!dead) {
      if (gl.errors.length > feedbackErrorCount) {
        record({ action: 'production feedback', error: gl.errors.slice(feedbackErrorCount).join('; ') }); feedbackErrorCount = gl.errors.length
      }
      if (!busy) {
        status.textContent = `${playing ? 'Running' : 'Paused'} · ${scene} · style ${alternate ? 'B' : 'A'} · ` +
        `${width} × ${height} CSS px per panel · DPR ${ratio}`
      }
      const last = gl.feedback.at(-1)
      host.querySelector<HTMLElement>('[data-gl-status]')!.textContent = `Tick ${gl.tick} · ` +
        `${gl.graph.isSimulationRunning ? 'simulating' : 'paused / cooled'} · ${clickedPointLabel(gl.selected)} · ` +
        `last ${last?.kind ?? 'input unchecked'} ${last?.ms.toFixed(1) ?? '—'} ms${gl.errors.length ? ' · feedback error' : ''}`
      host.querySelector<HTMLElement>('[data-gpu-status]')!.textContent = `Tick ${gpu.tick} · ${clickedPointLabel(gpu.renderer.selected)} · ` +
        `last ${gpu.feedback.at(-1)?.ms.toFixed(1) ?? 'unchecked'} ms`
    }
  }
  const syncViewport = async (): Promise<void> => {
    if (dead || !visible || busy) return
    viewportQueued = false
    const nextWidth = Math.max(1, Math.floor(panel.getBoundingClientRect().width)); const nextRatio = devicePixelRatio
    if (nextWidth === width && nextRatio === ratio) { schedule(); return }
    busy = true; stopLoop(); update(); await flight
    try {
      if (dead || !visible) { viewportQueued = true; return }
      width = nextWidth; glHost.style.width = `${width}px`; canvas.style.width = `${width}px`
      if (ratio !== nextRatio) { ratio = nextRatio; gl.graph.setConfigPartial({ pixelRatio: ratio }) }
      await resize(false)
    } catch (error) {
      failure = String(error); playing = false; record({ action: 'viewport resize', error: failure })
    } finally {
      busy = false
      if (!dead) { update(); if (viewportQueued) queueViewport(); else schedule() }
    }
  }
  const queueViewport = (): void => {
    syncViewport().catch(error => { if (!dead) { failure = String(error); playing = false; update() } })
  }
  const requestViewport = (): void => {
    if (dead) return
    const nextWidth = Math.max(1, Math.floor(panel.getBoundingClientRect().width))
    if (nextWidth === width && devicePixelRatio === ratio && !viewportQueued) return
    viewportQueued = true
    if (busy) cancelled = true
    queueViewport()
  }
  const action = async (name: string): Promise<void> => {
    if (name === 'cancel') { cancelled = true; return }
    if (busy || dead) return
    const paint = ['paint', 'paint-layers', 'paint-link-smoothing', 'paint-corrected-links'].includes(name)
    const correctedLinks = name === 'paint-corrected-links'
    if (name !== 'export') interacted = true
    const startedAt = pauseGeneration
    failure = ''; busy = true; cancelled = false; stopLoop(); update(); await flight
    if (dead || !visible || pauseGeneration !== startedAt) {
      busy = false; if (!dead) { update(); if (viewportQueued) queueViewport(); else schedule() }
      return
    }
    const wasPlaying = playing; let failed = false
    try {
      if (name === 'run') playing = true
      if (name === 'pause') playing = false
      if (name === 'fit') { gl.fit(); fit(gpu, (await gpu.backend.read()).positions) }
      if (name === 'style') {
        alternate = !alternate; style(); await Promise.all([gl.frame(false), gpu.frame(false)])
        if (visible && pauseGeneration === startedAt) await check()
      }
      if (name === 'chain' || name === 'karate') {
        scene = name; alternate = false; await gl.replace(scene); await gpu.replace(scene, 32); style()
        fit(gpu, (await gpu.backend.read()).positions); await gpu.frame(false); await check()
      }
      if (name === 'resize') { height = height === 320 ? 280 : 320; await resize(true); if (visible) await check() }
      if (name === 'recreate') {
        feedbackHistory.push({ production: [...gl.feedback], candidate: [...gpu.feedback], productionErrors: [...gl.errors] })
        const old = gl.canvas; gl.destroy(); gpu.destroy(); gl.destroy(); gpu.destroy()
        scene = 'karate'; alternate = false; height = 320; feedbackErrorCount = 0; glHost.style.height = '320px'; canvas.style.height = '320px'
        await create()
        record({ action: 'recreate', oldCanvasDetached: !old.isConnected, candidateReady: !gpu.destroyed }); await check()
      }
      if (paint) {
        playing = false; gl.graph.pause(); gpu.pause(); style()
        record({
          action: 'same-geometry-paint',
          scene,
          pointCount: gpu.data.input.points.length / 4,
          linkCount: gpu.data.graph.links.length / 2,
          style: alternate ? 'B' : 'A',
          ...await comparePaint(gl, gpu, {
            attributeLayers: name !== 'paint',
            smoothLinks: name === 'paint-link-smoothing' || correctedLinks,
            distanceOpacity: correctedLinks,
          }),
        })
      }
      if (name === 'check') await check()
      if (name === 'assess') {
        playing = false; scene = 'karate'; alternate = false
        let hidden = document.visibilityState !== 'visible'
        const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
        document.addEventListener('visibilitychange', visibility)
        try {
          host.querySelector('[data-panels]')!.scrollIntoView({ block: 'center' })
          await assessViewers(gl, gpu, () => {
            if (dead || cancelled || hidden) throw new Error('Assessment interrupted; completed records retained')
          }, s => { status.textContent = s }, record)
        } finally { document.removeEventListener('visibilitychange', visibility) }
      }
      if (name === 'export') {
        const blob = new Blob([JSON.stringify({
          protocol,
          protocolNote: 'The protocol describes the full available assessment; only the actions in records and feedback were recorded. ' +
            'The migration statuses are historical context, not verdicts inferred from this export.',
          recordedAt: new Date().toISOString(),
          gl: gl.info,
          gpu: gpu.info,
          viewport: [width, height, ratio],
          records,
          recoveredSessions: recovered,
          feedbackHistory,
          productionFeedback: gl.feedback,
          productionErrors: gl.errors,
          candidateFeedback: gpu.feedback,
          strictCompatibility: 'Not established',
          fullMigration: 'Not ready',
        }, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'viewer-comparison-local.json'
        a.click(); URL.revokeObjectURL(url)
      }
    } catch (e) { failure = String(e); record({ error: failure, action: name }); playing = false; failed = true } finally {
      if (!paint && !['run', 'pause', 'assess'].includes(name) &&
        !dead && !failed && visible && pauseGeneration === startedAt) playing = wasPlaying
      busy = false; if (!dead) { update(); if (viewportQueued) queueViewport(); else schedule() }
    }
  }
  const abort = new AbortController()
  host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b => {
    b.addEventListener('click', () => { action(b.dataset.action!) }, { signal: abort.signal })
  })
  const observer = new ResizeObserver(requestViewport); observer.observe(panel)
  window.addEventListener('resize', requestViewport, { signal: abort.signal })
  let resolution = window.matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
  const watchResolution = (): void => {
    resolution.removeEventListener('change', watchResolution)
    resolution = window.matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
    resolution.addEventListener('change', watchResolution); requestViewport()
  }
  resolution.addEventListener('change', watchResolution)
  const timer = setInterval(update, 500); update(); schedule()
  return {
    pause: (): void => { visible = false; playing = false; cancelled = true; pauseGeneration++; stopLoop(); gl.graph.pause(); gpu.pause() },
    resume: (): void => { if (!dead) { visible = true; requestViewport(); if (!viewportQueued) schedule() } },
    saveEvidence: (): SavedSession[] | undefined => {
      const changed = records.length || feedbackHistory.length || gl.feedback.length || gl.errors.length || gpu.feedback.length ||
        gl.tick || gpu.tick || scene !== 'karate' || alternate || gl.selected !== undefined || gpu.renderer.selected !== -1 || busy || interacted
      if (!changed && !recovered.length) return undefined
      const sessions = changed
        ? [...recovered, {
          savedAt: new Date().toISOString(),
          gl: gl.info,
          gpu: gpu.info,
          viewport: [width, height, ratio],
          interrupted: busy,
          records,
          feedbackHistory,
          productionFeedback: gl.feedback,
          productionErrors: gl.errors,
          candidateFeedback: gpu.feedback,
        }]
        : recovered
      return structuredClone(sessions)
    },
    restoreEvidence: (evidence: unknown): void => {
      if (!Array.isArray(evidence)) throw new Error('Invalid saved graph comparison results')
      recovered.push(...evidence as SavedSession[]); renderRecovered()
    },
    destroy: (): void => {
      dead = true; cancelled = true; disposeRunLayout(host); stopLoop(); clearInterval(timer); abort.abort(); interactionAbort.abort(); observer.disconnect()
      resolution.removeEventListener('change', watchResolution); gl.destroy(); gpu.destroy()
    },
  }
}
