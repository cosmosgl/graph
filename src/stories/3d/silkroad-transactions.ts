import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

/**
 * The Silk Road Bitcoin transaction network, with a 2D/3D toggle and a pause control.
 *
 * Loads `silkroad-184R7cFG-4lv.parquet` straight from the network and parses it in the browser with
 * hyparquet (https://github.com/hyparam/hyparquet; the file's data pages are GZIP-compressed, so
 * hyparquet-compressors supplies that codec). Each row is a transaction `source -> target` (Bitcoin
 * addresses) with a `value` in satoshis — ~100K transactions between ~26K addresses, with no
 * coordinates, so the GPU force simulation lays the flow network out live. Every address is sized and
 * colored by the total value flowing through it, so the major hubs stand out as bright gold nodes.
 *
 * The "2D / 3D" buttons switch the rendering mode in place: the layout in the new dimension
 * continues from the live coordinates of the previous one (the framing is carried across the
 * projection switch, and the camera glides through the top-down pose so the cut is seamless).
 * "Pause"/"Resume" freezes and resumes the simulation. Drag to orbit (3D) or pan (2D), scroll to zoom.
 */
const PARQUET_URL = 'https://d.cosmograph.app/silkroad-184R7cFG-4lv.parquet'
const SATOSHIS_PER_BTC = 1e8
const SPACE_SIZE = 4096

export const silkroadTransactions3d = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.position = 'relative'
  div.style.height = '100vh'
  div.style.width = '100%'

  const graphDiv = document.createElement('div')
  graphDiv.style.position = 'absolute'
  graphDiv.style.inset = '0'
  div.appendChild(graphDiv)

  // ---- Controls (top-left overlay) --------------------------------------------------------------
  const controls = document.createElement('div')
  controls.style.cssText = `position:absolute;top:12px;left:12px;z-index:2;display:none;gap:8px;
    align-items:center;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;`

  const mkButton = (label: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `appearance:none;border:none;color:#e6ebff;background:transparent;
      padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit;`
    return b
  }
  const panel = (): HTMLDivElement => {
    const p = document.createElement('div')
    p.style.cssText = `display:flex;gap:2px;background:rgba(18,20,28,0.72);border:1px solid rgba(255,255,255,0.12);
      border-radius:8px;padding:3px;backdrop-filter:blur(6px);`
    return p
  }

  const modeGroup = panel()
  const btn2d = mkButton('2D')
  const btn3d = mkButton('3D')
  modeGroup.append(btn2d, btn3d)

  const pauseGroup = panel()
  const btnPause = mkButton('Pause')
  pauseGroup.append(btnPause)

  controls.append(modeGroup, pauseGroup)
  div.appendChild(controls)

  // Loading overlay (removed once the graph is built).
  const status = document.createElement('div')
  status.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;
    color:#cdd6f4;font:500 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    text-align:center;pointer-events:none;text-shadow:0 1px 3px #000;`
  status.textContent = 'Loading Silk Road transactions…'
  div.appendChild(status)

  const config: GraphConfig = {
    spaceSize: SPACE_SIZE,
    spaceDimensions: 3,
    backgroundColor: '#0a0a14',
    pointDefaultSize: 2,
    linkDefaultWidth: 0.5,
    linkDefaultColor: '#8a6a30',
    linkOpacity: 0.8,
    scalePointsOnZoom: true,
    curvedLinks: false,
    enableDrag: true,
    enableSimulation: true,
    simulationGravity: 0.4,
    simulationRepulsion: 1.5,
    simulationLinkSpring: 0.15,
    simulationLinkDistance: 10,
    simulationFriction: 0.85,
    simulationCollision: 0.75,
    simulationCollisionPadding: 2,
    simulationDecay: 1000,
    cameraFov: 55,
    pointSphereShading: true,
    fitViewOnInit: false,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  // Graph data (filled once, after the parquet is parsed). Only the initial 3D positions are kept:
  // mode switches keep the live coordinates, so the next layout continues from the previous one.
  let links = new Float32Array(0)
  let colors = new Float32Array(0)
  let sizes = new Float32Array(0)
  let positions3d = new Float32Array(0)
  let dataReady = false

  let mode: '2d' | '3d' = '3d'
  let paused = false
  let destroyed = false
  const timeouts: ReturnType<typeof setTimeout>[] = []

  const graph = new Graph(graphDiv, config)
  graph.render()

  // Push the parsed data into the graph (first build only — mode switches don't re-ingest).
  const applyData = (): void => {
    graph.setPointPositions(positions3d, { dimensions: 3 })
    graph.setPointColors(colors)
    graph.setPointSizes(sizes)
    graph.setLinks(links)
    graph.render()
    if (paused) graph.pause()
  }

  const updateControls = (): void => {
    btn2d.style.background = mode === '2d' ? 'rgba(255,255,255,0.16)' : 'transparent'
    btn3d.style.background = mode === '3d' ? 'rgba(255,255,255,0.16)' : 'transparent'
    btnPause.textContent = paused ? 'Resume' : 'Pause'
  }

  // Switch the rendering mode in place: positions stay on the GPU, so the layout in the new
  // dimension starts from the coordinates of the previous one (z freezes in 2D and resumes in 3D),
  // and the engine hands the on-screen framing across the projection switch.
  const setMode = (next: '2d' | '3d'): void => {
    if (!dataReady || next === mode) return
    mode = next
    paused = false
    if (next === '2d') {
      // Glide to the top-down pose first — from there the perspective→flat cut is seamless —
      // then flatten and re-energize the simulation to settle the layout in 2D.
      graph.setCameraState({ azimuth: 0, polar: Math.PI / 2 }, 500)
      timeouts.push(setTimeout(() => {
        if (destroyed) return
        graph.setConfigPartial({ spaceDimensions: 2 })
        graph.start(0.6)
      }, 520))
    } else {
      // Enter 3D at the matched top-down framing, re-energize so the flat layout opens into
      // depth, and swing the camera out to reveal it.
      graph.setConfigPartial({ spaceDimensions: 3 })
      graph.start(0.6)
      graph.setCameraState({ azimuth: 0.6, polar: Math.PI / 2.4 }, 700)
    }
    updateControls()
  }

  btn2d.addEventListener('click', () => setMode('2d'))
  btn3d.addEventListener('click', () => setMode('3d'))
  btnPause.addEventListener('click', () => {
    if (!dataReady) return
    paused = !paused
    if (paused) graph.pause()
    else graph.unpause()
    updateControls()
  })

  const load = async (): Promise<void> => {
    // 1. Fetch and parse the parquet file with hyparquet (only the columns we need).
    status.textContent = 'Fetching transactions…'
    const file = await (await fetch(PARQUET_URL)).arrayBuffer()
    if (destroyed) return
    status.textContent = 'Parsing transactions…'
    const rows = await parquetReadObjects({
      file,
      compressors, // the file's data pages are GZIP-compressed
      columns: ['source', 'target', 'value'],
    }) as { source: string; target: string; value: number | bigint }[]
    if (destroyed) return

    // 2. Map the address strings to dense point indices, build the link list, and accumulate the total
    //    value (satoshis) flowing through each address (in + out).
    status.textContent = 'Building graph…'
    const idToIndex = new Map<string, number>()
    links = new Float32Array(rows.length * 2)
    const throughput: number[] = []
    let nodeCount = 0
    const indexOf = (id: string): number => {
      let index = idToIndex.get(id)
      if (index === undefined) {
        index = nodeCount++
        idToIndex.set(id, index)
        throughput[index] = 0
      }
      return index
    }
    for (const [i, row] of rows.entries()) {
      if (!row) continue
      const source = indexOf(row.source)
      const target = indexOf(row.target)
      links[i * 2] = source
      links[i * 2 + 1] = target
      const value = Number(row.value ?? 0)
      throughput[source] = (throughput[source] ?? 0) + value
      throughput[target] = (throughput[target] ?? 0) + value
    }

    // 3. Rank addresses by total value flowing through them and drive size/color off the percentile
    //    (with a gamma curve). Every address moves a large satoshi amount, so an absolute scale washes
    //    out; ranking makes the biggest hubs read as large bright nodes while the long tail stays small.
    const order = Array.from({ length: nodeCount }, (_, i) => i)
      .sort((a, b) => (throughput[a] ?? 0) - (throughput[b] ?? 0))
    const percentile = new Float64Array(nodeCount)
    for (let r = 0; r < nodeCount; r++) percentile[order[r] as number] = nodeCount > 1 ? r / (nodeCount - 1) : 0

    // 4. Initial positions (a loose sphere) plus per-node color and size.
    const center = SPACE_SIZE / 2
    const radius = SPACE_SIZE * 0.4
    positions3d = new Float32Array(nodeCount * 3)
    colors = new Float32Array(nodeCount * 4)
    sizes = new Float32Array(nodeCount)
    for (let i = 0; i < nodeCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const u = Math.random() * 2 - 1
      const r3 = radius * Math.cbrt(Math.random())
      const s = Math.sqrt(1 - u * u)
      positions3d[i * 3] = center + r3 * s * Math.cos(angle)
      positions3d[i * 3 + 1] = center + r3 * s * Math.sin(angle)
      positions3d[i * 3 + 2] = center + r3 * u

      const t = (percentile[i] ?? 0) ** 3 // percentile, gamma-curved so only the top hubs read bright/large
      colors[i * 4] = 0.24 + t * 0.76 // dim slate → warm gold
      colors[i * 4 + 1] = 0.30 + t * 0.52
      colors[i * 4 + 2] = 0.46 - t * 0.22
      colors[i * 4 + 3] = 0.9
      sizes[i] = 5 + t * 5
    }

    // 5. First build on the existing (empty) graph, then reveal the controls.
    dataReady = true
    applyData()
    status.remove()
    controls.style.display = 'flex'
    updateControls()

    const totalBtc = Math.round(throughput.reduce((a, b) => a + b, 0) / 2 / SATOSHIS_PER_BTC)
    console.info(`Silk Road graph: ${nodeCount.toLocaleString()} addresses, ` +
      `${rows.length.toLocaleString()} transactions, ${totalBtc.toLocaleString()} BTC moved`)
  }

  load().catch((error: unknown) => {
    status.textContent = `Failed to load transactions: ${error instanceof Error ? error.message : String(error)}`
    console.error(error)
  })

  const destroy = (): void => {
    destroyed = true
    for (const t of timeouts) clearTimeout(t)
    graph.destroy()
  }

  return { div, graph, destroy }
}
