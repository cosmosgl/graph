import { Graph, type GraphConfig } from '@cosmos.gl/graph'

// One far point against the many-body grid. The grid is fitted to the data's
// bounding box every tick and has a fixed number of cells for a point count, so
// its cell size is the box's side divided by that count — and the box is set by
// the two most extreme points. The left pane runs a blob alone. The right pane
// runs the same blob, same seed, same forces, plus one point far away. Far
// enough, the whole blob falls into one finest cell: the far field has no
// occupied cells to sum and the near field is a fixed random sample of the
// cell, so repulsion turns weak and noisy while gravity does not, and the blob
// settles smaller and porous. A point gravity can bring back heals it; with
// gravity 0, or a pinned point, it never does.
//
// The readout gives, per pane, the blob's extent, the finest cell size the
// box implies and how many finest cells the blob spans. The far point is red
// and large. "fit blob" frames the blob in both panes; "fit view" frames every
// point, which in the right pane is the box the grid is fitted to.

const SPACE_SIZE = 4096
const CENTRE = SPACE_SIZE / 2
const SIZES = [20_000, 100_000] as const
const DISTANCES = [1e5, 1e6, 1e7] as const
const GRAVITIES = [0, 0.25] as const
const READOUT_INTERVAL_MS = 250
const BLOB_SEED = 99
const SIMULATION_SEED = 3
const MAX_GRID_SIZE = 512

const BLOB_COLOR = [0.35, 0.55, 0.85, 0.7] as const
const FAR_COLOR = [0.95, 0.22, 0.24, 1] as const

/**
 * Mirrors the engine's finest many-body grid size for a point count
 * (Shared/cell-slots.ts), which it does not expose: 2·√n rounded up to a power
 * of two, between 8 and 512.
 */
const finestGridSize = (n: number): number =>
  Math.min(MAX_GRID_SIZE, Math.max(8, 2 ** Math.ceil(Math.log2(2 * Math.sqrt(n)))))

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** A 400-unit square blob at the centre, the same for both panes, plus the far point when asked. */
const makePositions = (n: number, far?: number): Float32Array => {
  const random = createRandom(BLOB_SEED)
  const positions = new Float32Array((n + (far === undefined ? 0 : 1)) * 2)
  for (let i = 0; i < n; i += 1) {
    positions[i * 2] = CENTRE - 200 + random() * 400
    positions[i * 2 + 1] = CENTRE - 200 + random() * 400
  }
  if (far !== undefined) {
    positions[n * 2] = CENTRE + far
    positions[n * 2 + 1] = CENTRE + far
  }
  return positions
}

type Stats = { blobExtent: number; boxSide: number; farAt: number | undefined }

/** Extent of the blob (the first n points) and of everything, from a readback. */
const measure = (positions: Float32Array, n: number, hasFar: boolean): Stats => {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
  for (let i = 0; i < n; i += 1) {
    const x = positions[i * 2] as number
    const y = positions[i * 2 + 1] as number
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const blobExtent = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) : 0
  let boxSide = blobExtent
  let farAt: number | undefined
  if (hasFar) {
    const fx = positions[n * 2] as number
    const fy = positions[n * 2 + 1] as number
    farAt = Math.max(Math.abs(fx - CENTRE), Math.abs(fy - CENTRE))
    boxSide = Math.max(
      Math.max(maxX, fx) - Math.min(minX, fx),
      Math.max(maxY, fy) - Math.min(minY, fy)
    )
  }
  return { blobExtent, boxSide, farAt }
}

type Pane = {
  graph: Graph;
  host: HTMLDivElement;
  readout: HTMLPreElement;
  hasFar: boolean;
  tick: number;
  readTick: number;
  readback: Float32Array;
}

export const farPoint = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.cssText = 'position:relative;height:100vh;width:100%;overflow:hidden;display:flex;background:#0b0c0e;'

  let pointsNumber: number = SIZES[0]
  let distance: number = DISTANCES[2]
  let gravity: number = GRAVITIES[1]
  let isRunning = true
  let hasPoints = false
  let disposed = false

  const makePane = (title: string, hasFar: boolean): Pane => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:relative;flex:1 1 0;min-width:0;margin:6px;'
    div.appendChild(wrap)
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;inset:0;'
    wrap.appendChild(host)
    const label = document.createElement('div')
    label.style.cssText = 'position:absolute;top:12px;left:12px;padding:8px 10px;font:12px/1.6 monospace;' +
      'color:#fff;background:rgba(0,0,0,0.7);border-radius:6px;z-index:2;pointer-events:none;'
    const heading = document.createElement('div')
    heading.textContent = title
    heading.style.fontWeight = 'bold'
    label.appendChild(heading)
    const readout = document.createElement('pre')
    readout.style.cssText = 'margin:4px 0 0;font:inherit;'
    readout.textContent = 'Initialising…'
    label.appendChild(readout)
    wrap.appendChild(label)

    const pane: Pane = {
      graph: undefined as unknown as Graph,
      host,
      readout,
      hasFar,
      tick: 0,
      readTick: -1,
      readback: new Float32Array(0),
    }
    const config: GraphConfig = {
      spaceSize: SPACE_SIZE,
      backgroundColor: '#16181d',
      fitViewOnInit: false,
      renderLinks: false,
      pointDefaultSize: 3,
      simulationGravity: gravity,
      // Alpha held at 1: the collapse is a steady state to watch, not a transient
      simulationDecay: 1e12,
      randomSeed: SIMULATION_SEED,
      onSimulationTick: () => { pane.tick += 1 },
    }
    pane.graph = new Graph(host, config)
    return pane
  }

  const alone = makePane('blob alone', false)
  const withFar = makePane('blob + one far point', true)
  const panes = [alone, withFar]

  const refresh = (pane: Pane, force = false): void => {
    if (!hasPoints || disposed) return
    if (!force && pane.tick === pane.readTick) return
    const n = pointsNumber
    const positions = pane.graph.getPointPositionsArray(pane.readback)
    if (positions.length < (n + (pane.hasFar ? 1 : 0)) * 2) return
    pane.readback = positions
    pane.readTick = pane.tick
    const { blobExtent, boxSide, farAt } = measure(positions, n, pane.hasFar)
    const cell = boxSide / finestGridSize(n)
    const lines = [
      `tick: ${pane.tick}`,
      `blob extent: ${Math.round(blobExtent)}`,
      `box side: ${Math.round(boxSide).toLocaleString('en')}`,
      `finest cell: ${cell >= 100 ? Math.round(cell).toLocaleString('en') : cell.toFixed(1)} units`,
      `blob spans: ${(blobExtent / cell).toFixed(1)} cells per axis`,
    ]
    if (pane.hasFar && farAt !== undefined) lines.push(`far point: ${Math.round(farAt).toLocaleString('en')} units out`)
    pane.readout.textContent = lines.join('\n')
  }

  const refreshAll = (force = false): void => panes.forEach((pane) => refresh(pane, force))

  const frameBlob = (duration: number): void => {
    for (const pane of panes) {
      if (pane.host.clientWidth <= 0 || pane.host.clientHeight <= 0) continue
      if (pane.hasFar) {
        // The blob only: a fit to all points would frame the far point too
        const indices = Array.from({ length: pointsNumber }, (_, i) => i)
        pane.graph.fitViewByPointIndices(indices, duration, 0.15)
      } else {
        pane.graph.fitView(duration, 0.15)
      }
    }
  }

  // Every change restarts both panes from the same blob at tick 0
  const loadPoints = (): void => {
    for (const pane of panes) {
      const n = pointsNumber + (pane.hasFar ? 1 : 0)
      const positions = makePositions(pointsNumber, pane.hasFar ? distance : undefined)
      const colors = new Float32Array(n * 4)
      const sizes = new Float32Array(n)
      for (let i = 0; i < n; i += 1) {
        const [r, g, b, a] = i < pointsNumber ? BLOB_COLOR : FAR_COLOR
        colors[i * 4] = r; colors[i * 4 + 1] = g; colors[i * 4 + 2] = b; colors[i * 4 + 3] = a
        sizes[i] = i < pointsNumber ? 3 : 14
      }
      pane.readback = new Float32Array(n * 2)
      // dontRescale: the far point must stay where it was put
      pane.graph.setPointPositions(positions, true)
      pane.graph.setPointColors(colors)
      pane.graph.setPointSizes(sizes)
      pane.graph.setConfigPartial({ simulationGravity: gravity })
      pane.graph.render(1, 0)
      pane.tick = 0
      pane.readTick = -1
    }
    hasPoints = true
    refreshAll(true)
  }

  const panel = document.createElement('div')
  // Bottom left, under the left pane: after "fit view" the right pane's blob sits at its
  // bottom-left corner, which is the middle of the story, so nothing may cover that.
  panel.style.cssText = 'position:absolute;bottom:16px;left:16px;padding:10px 12px;' +
    'font:12px/1.6 monospace;color:#fff;background:rgba(0,0,0,0.75);border-radius:6px;z-index:3;' +
    'display:flex;flex-direction:column;gap:6px;'
  div.appendChild(panel)

  const painters: (() => void)[] = []
  const repaintButtons = (): void => painters.forEach((paint) => paint())
  const addRow = (): HTMLDivElement => {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;'
    panel.appendChild(row)
    return row
  }
  const addButton = (row: HTMLDivElement, label: string, onClick: () => void, isActive?: () => boolean): void => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.style.cssText = 'font:11px monospace;padding:3px 8px;border-radius:4px;cursor:pointer;' +
      'border:1px solid #555;color:#fff;background:#2a2d34;'
    if (isActive) painters.push(() => { button.style.background = isActive() ? '#4b7bec' : '#2a2d34' })
    button.addEventListener('click', () => {
      if (!hasPoints || disposed) return
      onClick()
      repaintButtons()
    })
    row.appendChild(button)
  }

  const sizeRow = addRow()
  for (const size of SIZES) {
    addButton(sizeRow, `${size / 1000}k points`, () => { pointsNumber = size; loadPoints() }, () => pointsNumber === size)
  }
  const distanceRow = addRow()
  for (const value of DISTANCES) {
    addButton(distanceRow, `far point at ${value.toExponential(0).replace('e+', 'e')}`, () => { distance = value; loadPoints() }, () => distance === value)
  }
  const gravityRow = addRow()
  for (const value of GRAVITIES) {
    addButton(gravityRow, `gravity ${value}`, () => { gravity = value; loadPoints() }, () => gravity === value)
  }
  const actionRow = addRow()
  addButton(actionRow, 'run', () => { isRunning = true; panes.forEach((pane) => pane.graph.unpause()); refreshAll(true) }, () => isRunning)
  addButton(actionRow, 'pause', () => { isRunning = false; panes.forEach((pane) => pane.graph.pause()); refreshAll(true) }, () => !isRunning)
  addButton(actionRow, 'fit blob', () => frameBlob(250))
  // Every point: in the right pane, the box the grid is fitted to
  addButton(actionRow, 'fit view', () => panes.forEach((pane) => pane.graph.fitView(250, 0.1)))

  repaintButtons()

  const refreshTimer = window.setInterval(() => refreshAll(), READOUT_INTERVAL_MS)

  Promise.all(panes.map((pane) => pane.graph.ready)).then(() => {
    if (disposed) return
    loadPoints()
    frameBlob(0)
    panes.forEach((pane) => pane.graph.start())
  }).catch((error: unknown) => {
    alone.readout.textContent = `Failed to initialise: ${String(error)}`
  })

  return {
    // createStory destroys this one; the other pane is destroyed below
    graph: alone.graph,
    div,
    destroy: (): void => {
      disposed = true
      window.clearInterval(refreshTimer)
      withFar.graph.destroy()
    },
  }
}
