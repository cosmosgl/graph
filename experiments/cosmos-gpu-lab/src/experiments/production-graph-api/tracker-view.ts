import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { matchesTrackerSnapshot, runHeadlessTrackers, type TrackedGroup, type TrackerSample } from './headless-trackers'

function positionRows (group: TrackedGroup | undefined): string[] {
  if (!group) return ['Unavailable']
  // Preserve repeated requested slots and expose any unexpected IDs returned by a tracker.
  const ids = group.destroyed ? [] : [...group.indices]
  for (const [id] of group.positions) if (!ids.includes(id)) ids.push(id)
  if (!ids.length) return [group.destroyed ? 'Destroyed' : 'Empty']
  return ids.map(id => {
    const point = group.positions.find(([index]) => index === id)
    if (!point) return `${id} → absent`
    // Nine significant digits distinguish every float32 position in the table.
    return `${id} → (${Number(point[1].toPrecision(9))}, ${Number(point[2].toPrecision(9))})`
  })
}

export function createTrackerView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar"><label>Checkpoint <select data-checkpoint disabled></select></label></div>
    <button data-run-action="primary" data-replay type="button">Replay on this GPU</button>
    <div data-run-part="visualization">
      <p data-errors hidden></p>
      <table><caption>Point IDs and graph coordinates in the requested order</caption>
        <thead><tr><th>Tracker</th><th>WebGL</th><th>WebGPU</th></tr></thead><tbody></tbody>
      </table></div>
    <p data-run-part="status" data-tracker-status></p>`
  mountRunLayout(host)
  const checkpoint = host.querySelector<HTMLSelectElement>('[data-checkpoint]')!
  const replay = host.querySelector<HTMLButtonElement>('[data-replay]')!
  const errors = host.querySelector<HTMLElement>('[data-errors]')!
  const rows = host.querySelector('tbody')!
  const status = host.querySelector<HTMLElement>('[data-tracker-status]')!
  const engines = ['webgl', 'webgpu'] as const
  const labels = { webgl: 'WebGL', webgpu: 'WebGPU' }
  const samples: Record<typeof engines[number], TrackerSample[]> = { webgl: [], webgpu: [] }
  let disposed = false

  function showCheckpoint (): void {
    rows.replaceChildren()
    const gl = samples.webgl[checkpoint.selectedIndex]
    const gpu = samples.webgpu[checkpoint.selectedIndex]
    const mismatches: string[] = []
    let agree = true
    for (const [key, name] of [['first', 'A'], ['second', 'B']] as const) {
      const columns = [positionRows(gl?.[key]), positionRows(gpu?.[key])]
      const length = Math.max(...columns.map(column => column.length))
      for (let i = 0; i < length; i++) {
        const row = rows.insertRow()
        const tracker = document.createElement('th')
        tracker.scope = 'row'
        tracker.textContent = name
        row.append(tracker)
        for (const column of columns) row.insertCell().textContent = column[i] ?? '—'
      }
      if (gl && !matchesTrackerSnapshot(gl[key], gl.snapshot)) mismatches.push(`WebGL tracker ${name}`)
      if (gpu && !matchesTrackerSnapshot(gpu[key], gpu.snapshot)) mismatches.push(`WebGPU tracker ${name}`)
      if (gl && gpu) {
        const a = gl[key]; const b = gpu[key]
        agree &&= a.destroyed === b.destroyed && a.indices.length === b.indices.length && a.indices.every((id, i) => id === b.indices[i]) &&
          a.array.length === b.array.length && a.array.every((value, i) => Object.is(value, b.array[i]))
      }
    }
    if (mismatches.length) status.textContent = `Full position read differs for ${mismatches.join(' and ')}.`
    else if (!gl || !gpu) status.textContent = 'Both packages must finish to compare the trackers.'
    else {
      status.textContent = agree
        ? 'The tracker reads match each simulation’s full positions. Both packages returned identical results.'
        : 'The tracker reads match each simulation’s full positions. The two packages returned different results.'
    }
  }

  async function run (): Promise<void> {
    const selected = checkpoint.value
    replay.disabled = checkpoint.disabled = true
    rows.replaceChildren()
    errors.replaceChildren()
    errors.hidden = true
    status.textContent = 'Reading the two groups from each simulation…'
    for (const engine of engines) {
      if (disposed) return
      samples[engine] = []
      try { samples[engine] = (await runHeadlessTrackers(engine)).samples } catch (error) {
        if (disposed) return
        const detail = document.createElement('span')
        detail.textContent = `${labels[engine]} · ${error instanceof Error ? error.message : String(error)}`
        errors.append(detail, document.createElement('br'))
        errors.hidden = false
      }
    }
    if (disposed) return
    const completed = samples.webgl.length ? samples.webgl : samples.webgpu
    checkpoint.replaceChildren(...completed.map(sample => new Option(sample.phase, sample.phase)))
    if (completed.some(sample => sample.phase === selected)) checkpoint.value = selected
    replay.disabled = false
    checkpoint.disabled = !completed.length
    showCheckpoint()
  }

  checkpoint.onchange = showCheckpoint
  replay.onclick = run
  run()
  return { destroy (): void { disposed = true; disposeRunLayout(host) } }
}
