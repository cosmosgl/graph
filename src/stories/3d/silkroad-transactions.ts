import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

/**
 * The Silk Road Bitcoin transaction network, rendered in 3D.
 *
 * Loads `silkroad-184R7cFG-4lv.parquet` straight from the network and parses it in the browser with
 * hyparquet (https://github.com/hyparam/hyparquet; the file's data pages are GZIP-compressed, so
 * hyparquet-compressors supplies that codec). Each row is a transaction `source -> target` (Bitcoin
 * addresses) with a `value` in satoshis — ~100K transactions between ~26K addresses, with no
 * coordinates, so the 3D GPU force simulation lays the flow network out live. Every address is sized
 * and colored by the total value flowing through it, so the major hubs (markets, mixers, big wallets)
 * stand out as bright gold nodes. Drag to orbit, scroll to zoom.
 */
const PARQUET_URL = 'https://d.cosmograph.app/silkroad-184R7cFG-4lv.parquet'
const SATOSHIS_PER_BTC = 1e8

export const silkroadTransactions3d = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.position = 'relative'
  div.style.height = '100vh'
  div.style.width = '100%'

  const graphDiv = document.createElement('div')
  graphDiv.style.position = 'absolute'
  graphDiv.style.inset = '0'
  div.appendChild(graphDiv)

  // Loading overlay (removed once the graph is built).
  const status = document.createElement('div')
  status.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;
    color:#cdd6f4;font:500 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    text-align:center;pointer-events:none;text-shadow:0 1px 3px #000;`
  status.textContent = 'Loading Silk Road transactions…'
  div.appendChild(status)

  const config: GraphConfig = {
    spaceSize: 4096,
    backgroundColor: '#0a0a14',
    pointDefaultSize: 2,
    linkDefaultWidth: 0.15,
    linkDefaultColor: '#8a6a30',
    linkOpacity: 0.22,
    curvedLinks: false,
    enableSimulation: true,
    simulationGravity: 0,
    simulationRepulsion: 1.5,
    simulationLinkSpring: 1.0,
    simulationLinkDistance: 10,
    simulationFriction: 0.85,
    simulationDecay: 100000,
    cameraFov: 55,
    fitViewOnInit: false,
    enableDrag: false, // orbit-only exploration of the whole flow network
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(graphDiv, config)
  graph.render()

  let destroyed = false
  const timeouts: ReturnType<typeof setTimeout>[] = []

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
    const links = new Float32Array(rows.length * 2)
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

    // 3. Positions (a loose sphere so the layout is roughly framed from the start), plus per-node color
    //    and size scaled by log(total value) — the biggest money hubs become large, bright-gold nodes.
    const spaceSize = config.spaceSize ?? 4096
    const center = spaceSize / 2
    const radius = spaceSize * 0.4
    // Rank addresses by total value flowing through them and drive size/color off the percentile (with
    // a gamma curve). Every address moves a large satoshi amount, so an absolute scale washes out;
    // ranking guarantees the biggest hubs read as large bright nodes while the long tail stays small.
    const order = Array.from({ length: nodeCount }, (_, i) => i)
      .sort((a, b) => (throughput[a] ?? 0) - (throughput[b] ?? 0))
    const percentile = new Float64Array(nodeCount)
    for (let r = 0; r < nodeCount; r++) percentile[order[r] as number] = nodeCount > 1 ? r / (nodeCount - 1) : 0

    const positions = new Float32Array(nodeCount * 3)
    const colors = new Float32Array(nodeCount * 4)
    const sizes = new Float32Array(nodeCount)
    for (let i = 0; i < nodeCount; i++) {
      const u = Math.random() * 2 - 1
      const phi = Math.random() * Math.PI * 2
      const r = radius * Math.cbrt(Math.random())
      const s = Math.sqrt(1 - u * u)
      positions[i * 3] = center + r * s * Math.cos(phi)
      positions[i * 3 + 1] = center + r * s * Math.sin(phi)
      positions[i * 3 + 2] = center + r * u

      const t = (percentile[i] ?? 0) ** 3 // percentile, gamma-curved so only the top hubs read bright/large
      colors[i * 4] = 0.24 + t * 0.76 // dim slate → warm gold
      colors[i * 4 + 1] = 0.30 + t * 0.52
      colors[i * 4 + 2] = 0.46 - t * 0.22
      colors[i * 4 + 3] = 0.9
      sizes[i] = 1.2 + t * 13
    }

    // 4. Hand the data to the engine and frame it (refit as the layout expands and settles).
    graph.setPointPositions3d(positions)
    graph.setPointColors(colors)
    graph.setPointSizes(sizes)
    graph.setLinks(links)
    graph.render()
    graph.fitView(1000)
    for (const delay of [3000, 8000]) {
      timeouts.push(setTimeout(() => { if (!destroyed) graph.fitView(1000) }, delay))
    }

    const totalBtc = Math.round(throughput.reduce((a, b) => a + b, 0) / 2 / SATOSHIS_PER_BTC)
    console.info(`Silk Road graph: ${nodeCount.toLocaleString()} addresses, ` +
      `${rows.length.toLocaleString()} transactions, ${totalBtc.toLocaleString()} BTC moved`)
    status.remove()
  }

  load().catch((error: unknown) => {
    status.textContent = `Failed to load transactions: ${error instanceof Error ? error.message : String(error)}`
    console.error(error)
  })

  const destroy = (): void => {
    destroyed = true
    timeouts.forEach(clearTimeout)
    graph.destroy()
  }

  return { div, graph, destroy }
}
