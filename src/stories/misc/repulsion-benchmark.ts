import { Graph, type GraphConfig } from '@cosmos.gl/graph'

// Benchmarks the many-body repulsion cost across point counts, bypassing the
// requestAnimationFrame refresh cap (which pins the FPS monitor at 120 and hides
// the real per-step cost). It times batches of `graph.step()` calls — each runs
// the full force pipeline synchronously on the GPU — followed by a
// `getPointPositions()` readback that flushes the queue, so the elapsed wall
// time reflects actual GPU work per step.
//
// Data is pure points (no links) so the numbers isolate the repulsion force;
// gravity and link forces would only add a size-independent constant.

const SIZES = [2_000, 5_000, 20_000, 50_000, 100_000, 200_000]
const WARMUP_STEPS = 12
const MEASURE_STEPS = 40
const SPACE_SIZE = 4096

type Row = {
  size: number;
  ms: number;
  fps: number;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

const makePositions = (n: number): Float32Array => {
  const positions = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    // Uniform random across the space — a representative cell occupancy for the
    // grid. (The per-step cost is topology-independent, so exact seeding doesn't
    // matter.)
    positions[i * 2] = Math.random() * SPACE_SIZE
    positions[i * 2 + 1] = Math.random() * SPACE_SIZE
  }
  return positions
}

// Resolves to null (without timing anything) if the story is torn down while
// this size's graph is being set up — the caller stops the run.
const timeSize = async (div: HTMLDivElement, positions: Float32Array, isCancelled: () => boolean): Promise<number | null> => {
  const config: GraphConfig = {
    spaceSize: SPACE_SIZE,
    enableSimulation: true,
    fitViewOnInit: false,
    showFPSMonitor: false,
    renderLinks: false,
    pointDefaultSize: 2,
    // Keep alpha from decaying so every step does full-cost force work
    // (cost is alpha-independent, but this rules out any decay-related skips).
    simulationDecay: 1e12,
    simulationGravity: 0,
    simulationRepulsion: 1,
  }

  const graph = new Graph(div, config)
  try {
    // Device init is async; step()/getPointPositions() are no-ops until it resolves.
    await graph.ready
    if (isCancelled()) return null
    graph.setPointPositions(positions)
    graph.render()
    // Kill the internal rAF loop so it doesn't compete with our manual stepping.
    // (private at the type level, present at runtime)
    const stopFrames = (): void => (graph as unknown as { stopFrames: () => void }).stopFrames()
    stopFrames()
    graph.start(1)
    stopFrames()

    // Wait until positions are actually uploaded and readable before timing.
    let ready = false
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      ready = graph.getPointPositions().length > 0
      if (!ready) await nextFrame()
      if (isCancelled()) return null
    }
    // Timing an un-uploaded graph would measure no-op steps and report ~0ms
    // rows with infinite fps — fail loudly instead of publishing fake numbers.
    if (!ready) throw new Error(`positions for ${positions.length / 2} points never became readable`)

    for (let i = 0; i < WARMUP_STEPS; i += 1) graph.step()
    graph.getPointPositions() // flush warmup

    const t0 = performance.now()
    for (let i = 0; i < MEASURE_STEPS; i += 1) graph.step()
    graph.getPointPositions() // flush — forces all queued GPU steps to complete
    const t1 = performance.now()

    return (t1 - t0) / MEASURE_STEPS
  } finally {
    // Always tear the graph down, even if a step throws — otherwise its GPU
    // resources leak and later sizes can fail on memory-constrained devices.
    graph.destroy()
    await nextFrame()
  }
}

export const repulsionBenchmark = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const outer = document.createElement('div')
  outer.style.cssText = 'height:100vh;width:100%;background:#1a1d23;color:#e0e0e0;font-family:monospace;overflow:auto;'

  const status = document.createElement('div')
  status.style.cssText = 'padding:16px;font-size:14px;'
  status.textContent = 'Running benchmark…'
  outer.appendChild(status)

  const table = document.createElement('pre')
  table.style.cssText = 'padding:0 16px 16px;font-size:13px;line-height:1.6;'
  outer.appendChild(table)

  // Off-screen host for the graph under test (needs real size for the GL canvas).
  const bench = document.createElement('div')
  bench.style.cssText = 'position:absolute;left:-99999px;top:0;width:900px;height:600px;'
  outer.appendChild(bench)

  const rows: Row[] = []
  const render = (): void => {
    const header = 'size      per-step     max-fps'
    const lines = rows.map((r) => {
      const size = String(r.size).padStart(7)
      const ms = `${r.ms.toFixed(2)}ms`.padStart(9)
      const fps = String(Math.round(r.fps)).padStart(8)
      return `${size}   ${ms}   ${fps}`
    })
    table.textContent = [header, '─'.repeat(header.length), ...lines].join('\n')
  }

  // Storybook's teardown can only signal us — the loop below must notice and
  // stop, or it keeps creating graphs and stepping the GPU against a detached
  // DOM node long after the user has switched stories.
  let cancelled = false

  const run = async (): Promise<void> => {
    for (const size of SIZES) {
      if (cancelled) return
      status.textContent = `Running ${size.toLocaleString()} points…`
      await nextFrame()
      const ms = await timeSize(bench, makePositions(size), () => cancelled)
      if (ms === null) return // story torn down mid-size
      rows.push({
        size,
        ms,
        fps: 1000 / ms,
      })
      render()
      // eslint-disable-next-line no-console
      console.log(`[benchmark] ${size} pts: ${ms.toFixed(2)}ms/step`)
    }
    status.textContent = `Done. ${WARMUP_STEPS} warmup + ${MEASURE_STEPS} measured steps per size; times are per-step GPU cost (rAF cap bypassed).`
    // eslint-disable-next-line no-console
    console.log('[benchmark] complete')
  }

  run().catch((error) => {
    status.textContent = `Benchmark failed: ${String(error)}`
    // eslint-disable-next-line no-console
    console.error('[benchmark] failed', error)
  })

  // The story contract wants a graph; hand back a tiny throwaway so teardown is uniform.
  const placeholderDiv = document.createElement('div')
  const graph = new Graph(placeholderDiv, { enableSimulation: false })

  return {
    graph,
    div: outer,
    destroy: (): void => {
      cancelled = true
      graph.destroy()
    },
  }
}
