import { createLiveChecks } from '../../runtime/live-checks'
import { milliseconds } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { gridGroups, gridTrials, runGridTrial } from './grid-suite'
import { gridEnvironment } from './cases'
import { createSpatialGridBackend, formatGridBytes, GridDeviceUnavailable, type SpatialGridBackend } from './backend'
import { createCpuGridReference, createGridPositions, validateGrid, type PointDistribution } from './reference'

function choices (key: string, label: string, options: Array<[string, string]>, selected: string): string {
  return `<div class="choice-control" role="group" data-control="${key}" aria-label="${label}">
    <span class="choice-label">${label}</span><div class="choice-options">
    ${options.map(([value, text]) => `<button type="button" value="${value}" aria-pressed="${value === selected}">${text}</button>`).join('')}
    </div></div>`
}

function renderHeatmap (canvas: HTMLCanvasElement, counts: Uint32Array, size: number): { occupied: number; maximum: number } {
  // One image pixel per cell. CSS scales the occupancy map with nearest-neighbor sampling.
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Heatmap canvas unavailable')
  let maximum = 0
  let occupied = 0
  for (const count of counts) {
    maximum = Math.max(maximum, count)
    if (count > 0) occupied++
  }
  const scale = Math.log1p(maximum)
  const image = context.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const intensity = scale && Math.log1p(counts[y * size + x]) / scale
      const pixel = ((size - 1 - y) * size + x) * 4
      image.data[pixel] = 42 + intensity * 112
      image.data[pixel + 1] = 54 + intensity * 151
      image.data[pixel + 2] = 68 + intensity * 120
      image.data[pixel + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return { occupied, maximum }
}

export async function createSpatialGridExperiment (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `
    <div class="choice-controls" data-run-part="configuration">
      ${choices('point-count', 'Points', [['100000', '100k'], ['1000000', '1M'], ['5000000', '5M']], '100000')}
      ${choices('grid-size', 'Cells per axis', ['32', '64', '128', '256'].map(size => [size, size]), '128')}
      ${choices('distribution', 'Distribution', [['uniform', 'Uniform'], ['clusters', 'Eight clusters'], ['diagonal', 'Diagonal']], 'uniform')}
    </div>
    <div class="reduction-preview" data-run-part="visualization">
      <canvas class="grid-canvas" width="128" height="128" aria-label="GPU cell occupancy. Brighter cells contain more points."></canvas>
      <div id="run-results">
        <output data-output="status"></output>
        <button type="button" data-action="retry" hidden>Retry</button>
      </div>
      <p class="reduction-specs" data-output="specs"></p>
      <dl class="grid-readouts">
        <div><dt>Occupied cells</dt><dd data-output="occupied">—</dd></div>
        <div><dt>Peak cell load</dt><dd data-output="maximum">—</dd></div>
        <div><dt>Build + completion</dt><dd data-output="timing">—</dd></div>
      </dl>
      <div class="controls reduction-benchmark" id="grid-benchmark">
        <button type="button" data-action="benchmark" disabled>Benchmark</button>
        <output data-output="benchmark"></output>
      </div>
    </div>`
  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.choice-options button'))
  const retry = host.querySelector<HTMLButtonElement>('[data-action="retry"]')!
  const benchmarkButton = host.querySelector<HTMLButtonElement>('[data-action="benchmark"]')!
  const selected = (key: string): string => host.querySelector<HTMLButtonElement>(`[data-control="${key}"] [aria-pressed="true"]`)!.value
  const output = (name: string): HTMLElement => host.querySelector<HTMLElement>(`[data-output="${name}"]`)!
  const status = output('status')
  const benchmarkOutput = output('benchmark')
  const canvas = host.querySelector('canvas')!
  let backend: SpatialGridBackend | undefined
  let validated = false
  let benchmarkCancelled = false
  let busy = false
  let destroyed = false
  let pending = Promise.resolve()

  function controls (): void {
    for (const button of buttons) button.disabled = busy
    retry.hidden = busy || validated
    benchmarkButton.disabled = busy || !validated
  }

  async function release (): Promise<void> {
    const current = backend
    backend = undefined
    if (current) {
      try { await current.waitForIdle() } finally { current.destroy() }
    }
  }

  function resetBuild (): void {
    validated = false
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    for (const key of ['occupied', 'maximum', 'timing']) output(key).textContent = '—'
    output('specs').textContent = ''
    benchmarkOutput.textContent = ''
    status.classList.remove('failed')
  }

  function perform (work: () => Promise<void>, feedback: HTMLElement): void {
    if (busy || destroyed) return
    checks.stop()
    busy = true
    controls()
    feedback.classList.remove('failed')
    pending = pending.then(work).catch(async (error: unknown) => {
      if (destroyed) return
      if (error instanceof GridDeviceUnavailable) checks.disable(error.message)
      if (feedback === status) {
        resetBuild()
        await release().catch(() => {})
        if (destroyed) return
      }
      feedback.classList.add('failed')
      feedback.textContent = error instanceof Error ? error.message : String(error)
    }).finally(() => {
      busy = false
      if (!destroyed) controls()
    })
  }

  function build (): void {
    perform(async () => {
      if (destroyed) return
      resetBuild()
      status.textContent = 'Building grid…'
      await release()
      if (destroyed) return
      const pointCount = Number(selected('point-count'))
      const gridSize = Number(selected('grid-size'))
      const positions = createGridPositions(pointCount, selected('distribution') as PointDistribution)
      const reference = createCpuGridReference(positions, gridSize)
      backend = await createSpatialGridBackend(positions, gridSize)
      if (destroyed) return
      checks.enable()
      const elapsed = await backend.build()
      if (destroyed) return
      status.textContent = 'Checking cell ranges…'
      const grid = await backend.readback()
      if (destroyed) return
      const check = validateGrid(positions, gridSize, reference, grid.counts, grid.offsets, grid.pointIndices)
      const { occupied, maximum } = renderHeatmap(canvas, grid.counts, gridSize)
      output('specs').textContent = `Scan ${backend.scanHierarchy.map(n => n.toLocaleString('en-US')).join(' → ')} · ` +
        `${formatGridBytes(backend.positionBytes)} positions · ${formatGridBytes(backend.gridBytes)} grid`
      output('occupied').textContent = `${occupied.toLocaleString('en-US')} / ${backend.cellCount.toLocaleString('en-US')}`
      output('maximum').textContent = `${maximum.toLocaleString('en-US')} points`
      output('timing').textContent = `${milliseconds(elapsed)} ms`
      validated = check.valid
      status.classList.toggle('failed', !validated)
      status.textContent = validated
        ? 'Every point appears once in the correct cell.'
        : `Mismatches: ${check.countMismatches} counts, ${check.offsetMismatches} offsets, ${check.invalidMemberships} memberships, ` +
        `${check.duplicateIndices} duplicate IDs, ${check.missingIndices} missing IDs.`
    }, status)
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const group = button.closest('[role="group"]')!
      if (button.getAttribute('aria-pressed') === 'true') return
      for (const option of group.querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === button))
      build()
    })
  }
  retry.addEventListener('click', build)
  async function benchmark (): Promise<void> {
    if (destroyed || benchmarkCancelled || !backend || !validated) return
    const { pointCount } = backend
    const iterations = pointCount >= 5_000_000 ? 1 : pointCount >= 1_000_000 ? 3 : 10
    benchmarkOutput.textContent = 'Warming up…'
    await backend.benchmark(iterations)
    const samples: number[] = []
    for (let i = 0; i < 6; i++) {
      if (destroyed || benchmarkCancelled) return
      benchmarkOutput.textContent = `Sample ${i + 1} of 6…`
      samples.push((await backend.benchmark(iterations)).averageMilliseconds)
    }
    if (destroyed || benchmarkCancelled) return
    samples.sort((a, b) => a - b)
    // Nearest-rank percentiles of six per-build samples.
    benchmarkOutput.textContent = `p50 ${milliseconds(samples[2])} ms · p95 ${milliseconds(samples[5])} ms per build`
  }
  benchmarkButton.addEventListener('click', () => {
    benchmarkCancelled = false
    perform(benchmark, benchmarkOutput)
  })

  const checks = createLiveChecks({
    sectionId: 'doc-validation',
    recordedEnvironment: gridEnvironment,
    recordedLabel: 'Recorded',
    ruleNote: 'Each case checks every cell count, range and point ID against the CPU, including four corner points.',
    groups: gridGroups,
    showDuration: true,
    unavailableReason: navigator.gpu ? undefined : 'WebGPU is unavailable.',
    runCheck: (id, signal) => {
      const trial = gridTrials.find(item => item.distribution === id)!
      const result = pending.then(async () => {
        try {
          await runGridTrial(trial, undefined, signal)
        } catch (error) {
          if (error instanceof GridDeviceUnavailable && !signal.aborted) {
            checks.disable(error.message)
            validated = false
            controls()
          }
          throw error
        }
        return { status: 'passed' as const }
      })
      pending = result.then(() => {}, () => {})
      return result
    },
  })
  mountRunLayout(host)
  build()
  return {
    pageEndSection: checks.element,
    pause (): void {
      checks.stop()
      benchmarkCancelled = true
      if (busy && benchmarkOutput.textContent) benchmarkOutput.textContent = 'Benchmark interrupted.'
    },
    destroy (): void {
      if (destroyed) return
      destroyed = true
      checks.destroy()
      disposeRunLayout(host)
      pending.then(release).catch(() => {})
      host.replaceChildren()
    },
  }
}
