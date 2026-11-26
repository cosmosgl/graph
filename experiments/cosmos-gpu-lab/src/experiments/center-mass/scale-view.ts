import { createDevice } from '../../gpu/luma'
import { runScaleCount, scaleLimit, type CenterScaleResult } from './scale-study'

export function mountCenterScale (host: HTMLElement, begin: () => boolean, end: () => void): { pause(): void; destroy(): void } {
  host.innerHTML = `
    <h3>Center-force scale study</h3>
    <label>Point counts <input data-scale-counts type="text" value="8192"></label>
    <div class="controls">
      <button data-scale-run type="button">Run scale study</button>
      <button data-scale-stop type="button" disabled>Stop</button>
      <button data-scale-export type="button" disabled>Export JSON</button>
    </div>
    <p data-scale-status aria-live="polite">Not run. Keep this tab visible and pause other GPU work during measurements.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Points</th><th>Variant</th><th>Center error (world units)</th><th>Count</th><th>Strict sum bits</th>
      <th>Force check</th><th>Reduction GPU ms</th><th>Force GPU ms</th></tr></thead>
      <tbody data-scale-rows></tbody></table></div>
    <p>The current force is checked against the scalar reference for 64 points. The linear candidate is
      checked against every current force under the existing numerical tolerance. Visual and full-graph
      behavior are not assessed by this frozen input. WebGL timings include readback and cannot be compared
      directly with GPU timestamps.</p>
    <canvas data-scale-preview width="420" height="260" aria-label="Sample of input positions and computed centers"></canvas>
    <p>Static CPU-drawn preview: up to 2,000 input points; yellow = CPU center, blue = WebGPU high/low center,
      pink = WebGL center. This is a visualization of readback, not GPU rendering or a moving graph.</p>
  `
  const get = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const input = get<HTMLInputElement>('[data-scale-counts]')
  const run = get<HTMLButtonElement>('[data-scale-run]')
  const stop = get<HTMLButtonElement>('[data-scale-stop]')
  const exportButton = get<HTMLButtonElement>('[data-scale-export]')
  const status = get<HTMLElement>('[data-scale-status]')
  const table = get<HTMLElement>('[data-scale-rows]')
  const canvas = get<HTMLCanvasElement>('[data-scale-preview]')
  let cancelled = false; let destroyed = false
  let report: { environment: unknown; results: CenterScaleResult[]; status: string; error?: string } | undefined
  const number = (value: number | null): string => value === null ? 'Unavailable' : value.toPrecision(4)
  const preview = (result: CenterScaleResult): void => {
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#1e2530'; context.fillRect(0, 0, canvas.width, canvas.height)
    const point = (x: number, y: number): [number, number] => [(x - 1970) * 1.4 + 30, (y + 2130) * 1.4 + 30]
    context.fillStyle = '#6685a5'
    for (let i = 0; i < result.preview.length; i += 2) {
      const [x, y] = point(result.preview[i], result.preview[i + 1]); context.fillRect(x, y, 1, 1)
    }
    const marker = (x: number, y: number, color: string, size: number): void => {
      const [px, py] = point(x, y); context.strokeStyle = color; context.lineWidth = 2
      context.strokeRect(px - size, py - size, size * 2, size * 2)
    }
    marker(...result.cpuCenter, '#ffd762', 8)
    const gpu = result.webgpu.find(row => row.variant === 'high-low')!
    marker(gpu.aggregate[0] / gpu.aggregate[2], gpu.aggregate[1] / gpu.aggregate[2], '#78baff', 5)
    if ('center' in result.webgl) marker(...result.webgl.center, '#f5a1c7', 2)
  }
  const show = (result: CenterScaleResult): void => {
    for (const value of result.webgpu) {
      const row = document.createElement('tr')
      const cells = [result.count.toLocaleString(), value.variant, number(value.error), value.countExact ? 'Exact' : 'Failed',
        value.aggregateBitsExact ? 'Exact' : 'Different', value.sampledForceCheck.valid ? 'Pass' : 'Failed',
        number(value.reduction.summary.gpuMs), number(value.force.summary.gpuMs)]
      for (const text of cells) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell) }
      table.append(row)
    }
    const high = result.webgpu.find(value => value.variant === 'high-low')!
    const linear = document.createElement('tr')
    const linearCells = [result.count.toLocaleString(), 'high-low + linear force', number(high.error), high.countExact ? 'Exact' : 'Failed',
      high.aggregateBitsExact ? 'Exact' : 'Different', result.linearForce.comparisonToCurrent.valid ? 'Pass (all)' : 'Failed',
      number(high.reduction.summary.gpuMs), number(result.linearForce.timing.summary.gpuMs)]
    for (const text of linearCells) { const cell = document.createElement('td'); cell.textContent = text; linear.append(cell) }
    table.append(linear)
    const gl = document.createElement('tr')
    const cells = 'center' in result.webgl
      ? [result.count.toLocaleString(), 'WebGL blend', number(result.webgl.error), result.webgl.countExact ? 'Exact' : 'Failed',
        'Not compared', 'Not run', 'Not timed', 'Not run']
      : [result.count.toLocaleString(), 'WebGL blend', result.webgl.error, 'Unavailable', 'Unavailable', 'Not run', 'Unavailable', 'Not run']
    for (const text of cells) { const cell = document.createElement('td'); cell.textContent = text; gl.append(cell) }
    table.append(gl); preview(result)
  }
  run.addEventListener('click', () => {
    // The operation reports errors in the status element.
    // eslint-disable-next-line no-void
    void (async (): Promise<void> => {
      const counts = input.value.split(',').map(value => Number(value.trim()))
      if (!counts.length || counts.some(count => !Number.isSafeInteger(count) || count < 1)) {
        status.textContent = 'Enter positive whole numbers separated by commas.'; return
      }
      if (!begin()) { status.textContent = 'Wait for the current demo tick to finish.'; return }
      cancelled = false; run.disabled = true; stop.disabled = false; exportButton.disabled = true; table.replaceChildren()
      let device: Awaited<ReturnType<typeof createDevice>> | undefined
      report = { environment: {}, results: [], status: 'running' }
      try {
        device = await createDevice('webgpu')
        report.environment = {
          browser: navigator.userAgent,
          recordedAt: new Date().toISOString(),
          visibility: document.visibilityState,
          info: device.info,
          luma: '10.0.0-alpha.15',
          maxCurrentPoints: scaleLimit(device),
          limits: {
            maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
            maxBufferSize: device.limits.maxBufferSize,
            maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
          },
        }
        for (const count of counts) {
          if (cancelled) break
          if (document.visibilityState !== 'visible') throw new Error('Keep the tab visible during measurement')
          status.textContent = `Preparing ${count.toLocaleString()} points…`
          const result = await runScaleCount(device, count, message => { status.textContent = message }, () => cancelled)
          report.results.push(result); if (!destroyed) show(result)
        }
        report.status = cancelled ? 'cancelled' : 'complete'
        if (!destroyed) {
          status.textContent = cancelled
            ? 'Stopped. Completed results are retained.'
            : 'Finished. Review the separate checks and export the results.'
        }
      } catch (error) {
        report.status = cancelled ? 'cancelled' : 'error'; report.error = String(error)
        if (!destroyed) status.textContent = `Stopped: ${String(error)}`
      } finally {
        device?.destroy(); if (!destroyed) { run.disabled = false; stop.disabled = true; exportButton.disabled = false; end() }
      }
    })()
  })
  stop.addEventListener('click', () => { cancelled = true; status.textContent = 'Stopping after the current GPU operation…' })
  exportButton.addEventListener('click', () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'center-scale.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  return { pause (): void { cancelled = true }, destroy (): void { cancelled = true; destroyed = true } }
}
