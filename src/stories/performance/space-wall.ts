import { Graph, type GraphConfig } from '@cosmos.gl/graph'

// Where `spaceSize` used to stop being a coordinate system and become a wall,
// and what a layout does now that it is not one. Positions used to be
// hard-clamped into `[0, spaceSize]` on every force sub-step, so a layout whose
// natural extent was larger than the space could not grow into it: it piled up
// along the border and took the border's square shape (300k points at default
// gravity: 58% of them on the border). Now nothing bounds a position
// (Points/update-position.frag bounds the length of one sub-step instead), and
// the layout grows past the space as far as its forces take it.
//
// The dashed square is the space, drawn in DOM from `spaceToScreenPosition` so
// it follows zoom and pan. Points beyond it are red. The readout reports, for
// the tick it was read at, the share of points beyond the space, the layout's
// extent next to the size gravity settles it at, and extent / spaceSize.
//
// Gravity is the control that decides it. It is a linear spring towards the
// world origin (the space's centre), so it caps the extent on its own: at 0.25
// a layout settles near 2·√(40n) units across, which fits 10k points in the
// space easily, fits 100k with ~1% to spare, and takes 300k well past it — into
// the disk the spring and the repulsion balance at, ~7,000 units across, with
// over half of its points beyond the space. At 0 repulsion has nothing to
// balance it, and the layout keeps expanding.
//
// "fit space" frames the space and "fit layout" frames the points: they are no
// longer the same thing. Both animate, so they need frames.
//
// Every size or gravity button restarts from the same seeded blob at tick 0.
// Runs agree in what the readout reports, not bit for bit: `randomSeed` seeds
// the simulation's random stream once per graph, and that stream runs on
// across reloads and through whatever ticks ran before "pause".
//
// Why there is a "step ×200" button: the animated simulation runs on
// requestAnimationFrame, which a hidden or background tab never schedules (an
// automated preview pane included), so a frame-driven story there advances
// nothing and measures nothing. The button runs `graph.step()` synchronously
// and then refreshes the readout and the colours. The initial framing is
// synchronous for the same reason.

const SPACE_SIZE = 4096
const SIZES = [10_000, 100_000, 300_000] as const
const GRAVITIES = [0, 0.25] as const
const STEPS_PER_BURST = 200
const READOUT_INTERVAL_MS = 250
/** Margin around the framed space or layout, as a fraction of the viewport on each side. */
const FRAME_PADDING = 0.05
const BLOB_SEED = 99
const SIMULATION_SEED = 3

const BEYOND_COLOR = [0.95, 0.22, 0.24, 0.95] as const
const INSIDE_COLOR = [0.35, 0.55, 0.85, 0.6] as const
/** The gravity the 2·√(40n) equilibrium extent was measured at. */
const EQUILIBRIUM_GRAVITY = 0.25

type SpaceStats = {
  beyond: number;
  nonFinite: number;
  extent: number;
}

/** Seeded LCG so every load starts from the same blob. */
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** A tight blob at the space centre, so the expansion is visible from tick 0. */
const makeBlobPositions = (n: number): Float32Array => {
  const random = createRandom(BLOB_SEED)
  const positions = new Float32Array(n * 2)
  const centre = SPACE_SIZE / 2
  for (let i = 0; i < n; i += 1) {
    const angle = random() * 2 * Math.PI
    // sqrt keeps the blob uniform by area rather than bunched at the centre
    const radius = Math.sqrt(random()) * SPACE_SIZE * 0.05
    positions[i * 2] = centre + Math.cos(angle) * radius
    positions[i * 2 + 1] = centre + Math.sin(angle) * radius
  }
  return positions
}

/**
 * Beyond the space: either coordinate strictly outside `[0, spaceSize]`. A
 * point exactly on the border counts as inside — it is where the old clamp
 * left every point the space stopped.
 */
const isBeyondSpace = (x: number, y: number): boolean =>
  x < 0 || x > SPACE_SIZE || y < 0 || y > SPACE_SIZE

/**
 * One pass over the read-back positions: counts the points beyond the space,
 * measures the extent, and paints `colors`. Only the first `pointsNumber`
 * points are read, so a reused readback buffer can never contribute a stale
 * tail.
 */
const measureAndPaint = (positions: Float32Array, pointsNumber: number, colors: Float32Array): SpaceStats => {
  let beyond = 0
  let nonFinite = 0
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < pointsNumber; i += 1) {
    const x = positions[i * 2] as number
    const y = positions[i * 2 + 1] as number
    // A NaN position must not reach the extent or the count. Counted, so
    // a diverged simulation shows up in the readout instead of hiding in it.
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      nonFinite += 1
      continue
    }
    const outside = isBeyondSpace(x, y)
    if (outside) beyond += 1
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    const [r, g, b, a] = outside ? BEYOND_COLOR : INSIDE_COLOR
    colors[i * 4] = r
    colors[i * 4 + 1] = g
    colors[i * 4 + 2] = b
    colors[i * 4 + 3] = a
  }
  const extent = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) : 0
  return { beyond, nonFinite, extent }
}

export const spaceWall = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.cssText = 'position:relative;height:100vh;width:100%;overflow:hidden;'

  const canvasHost = document.createElement('div')
  canvasHost.style.cssText = 'position:absolute;inset:0;'
  div.appendChild(canvasHost)

  // The space border. Its corners come from spaceToScreenPosition, so it sits
  // exactly on the space, at any zoom and pan.
  const border = document.createElement('div')
  // border-box keeps the dashed line inside the box, so all four outer edges
  // are the space's edges. content-box would put the right and bottom edges
  // 2px past them.
  border.style.cssText = 'position:absolute;box-sizing:border-box;border:1px dashed rgba(255,255,255,0.45);' +
    'pointer-events:none;z-index:1;'
  div.appendChild(border)

  const borderLabel = document.createElement('div')
  borderLabel.textContent = `spaceSize ${SPACE_SIZE}`
  borderLabel.style.cssText = 'position:absolute;font:11px monospace;color:rgba(255,255,255,0.45);' +
    'pointer-events:none;z-index:1;transform:translateY(-16px);white-space:nowrap;'
  div.appendChild(borderLabel)

  const panel = document.createElement('div')
  panel.style.cssText = 'position:absolute;top:16px;left:16px;padding:12px 14px;font:12px/1.6 monospace;' +
    'color:#fff;background:rgba(0,0,0,0.7);border-radius:6px;z-index:2;max-width:calc(100% - 60px);'
  div.appendChild(panel)

  // Plain `label: value` lines with no thousands separators, so the text can be
  // read back programmatically as easily as by eye.
  const readout = document.createElement('pre')
  readout.style.cssText = 'margin:0;font:inherit;'
  readout.textContent = 'Initialising…'
  panel.appendChild(readout)

  const legend = document.createElement('div')
  legend.style.cssText = 'margin-top:6px;opacity:0.6;'
  legend.textContent = 'red = beyond the spaceSize square'
  panel.appendChild(legend)

  let pointsNumber: number = SIZES[1]
  let gravity: number = GRAVITIES[0]
  let isRunning = true
  let hasPoints = false
  let hasFramed = false
  let disposed = false
  let tick = 0
  let readTick = -1
  let colors = new Float32Array(0)
  // Separate from the array handed to setPointPositions: the engine keeps a
  // reference to its input, which a readback must never overwrite.
  let readback: Float32Array = new Float32Array(0)

  const config: GraphConfig = {
    spaceSize: SPACE_SIZE,
    backgroundColor: '#16181d',
    fitViewOnInit: false,
    renderLinks: false,
    pointDefaultSize: 2,
    simulationGravity: gravity,
    // Never let the simulation cool off: the extent is a steady state to watch,
    // not a transient, and a decayed alpha would freeze it mid-expansion.
    // Every other force setting is stock.
    simulationDecay: 1e12,
    randomSeed: SIMULATION_SEED,
    onSimulationTick: () => { tick += 1 },
    onZoom: () => positionBorder(),
  }

  const graph = new Graph(canvasHost, config)

  const positionBorder = (): void => {
    const [left, bottom] = graph.spaceToScreenPosition([0, 0])
    const [right, top] = graph.spaceToScreenPosition([SPACE_SIZE, SPACE_SIZE])
    border.style.left = `${left}px`
    border.style.top = `${top}px`
    border.style.width = `${Math.max(0, right - left)}px`
    border.style.height = `${Math.max(0, bottom - top)}px`
    borderLabel.style.left = `${left}px`
    borderLabel.style.top = `${top}px`
  }

  const frameSpace = (duration: number): void => {
    // Fitting against an unmeasured (0-wide) container makes the fit scale 0,
    // which d3-zoom clamps to its zoom floor: the whole space collapses into a
    // few pixels. Only frame once the container has been laid out.
    const width = canvasHost.clientWidth
    const height = canvasHost.clientHeight
    if (width <= 0 || height <= 0) return
    if (duration > 0) {
      graph.fitViewByPointPositions([0, 0, SPACE_SIZE, SPACE_SIZE], duration, FRAME_PADDING)
    } else {
      // fitView* runs as a d3 transition, which advances on
      // requestAnimationFrame even at duration 0, so in a tab that never
      // schedules a frame it never lands. setZoomLevel at duration 0 applies
      // at once, scaling about the viewport centre. That frames the space
      // because this only runs from the initial view, which centres the space.
      graph.setZoomLevel((Math.min(width, height) * (1 - 2 * FRAME_PADDING)) / SPACE_SIZE, 0)
    }
    hasFramed = true
  }

  const frameLayout = (duration: number): void => {
    // Same guard as frameSpace: an unmeasured container fits to the zoom floor
    if (canvasHost.clientWidth <= 0 || canvasHost.clientHeight <= 0) return
    graph.fitView(duration, FRAME_PADDING)
    hasFramed = true
  }

  // Reads the positions back and refreshes the readout and the colours. The
  // readback is a synchronous GPU stall (~2.4 MB at 300k points), so it runs on
  // a timer and after a step burst, never per frame, and only when a tick has
  // actually run since the last read.
  const refresh = (force = false): void => {
    if (!hasPoints || disposed) return
    if (!hasFramed) frameSpace(0)
    if (force || tick !== readTick) {
      const positions = graph.getPointPositionsArray(readback)
      if (positions.length >= pointsNumber * 2) {
        readback = positions
        readTick = tick
        const { beyond, nonFinite, extent } = measureAndPaint(positions, pointsNumber, colors)
        // Where gravity 0.25 settles a layout of this size; without gravity
        // nothing does
        const equilibrium = gravity === EQUILIBRIUM_GRAVITY
          ? `settles near 2√(40n) = ${Math.round(2 * Math.sqrt(40 * pointsNumber))}`
          : 'no gravity, no equilibrium'
        readout.textContent = [
          `points: ${pointsNumber}`,
          `gravity: ${gravity}`,
          `state: ${isRunning ? 'running' : 'paused'}`,
          `tick: ${tick}`,
          `beyond space: ${((100 * beyond) / pointsNumber).toFixed(2)}% (${beyond})`,
          `extent: ${Math.round(extent)} (${equilibrium})`,
          `extent / spaceSize: ${(extent / SPACE_SIZE).toFixed(3)}`,
          `non-finite: ${nonFinite}`,
        ].join('\n')
        graph.setPointColors(colors)
        // setPointColors only queues the change, landing on the next render as
        // an 800 ms transition. Restarted on every readout it would never
        // finish, so snap it; `undefined` leaves alpha alone.
        graph.render(undefined, 0)
      }
    }
    positionBorder()
  }

  // Every size or gravity change restarts from the same blob at tick 0, so each
  // combination is measured from the same start rather than from whatever
  // state the previous one left behind.
  const loadPoints = (): void => {
    const positions = makeBlobPositions(pointsNumber)
    colors = new Float32Array(pointsNumber * 4)
    readback = new Float32Array(pointsNumber * 2)
    // dontRescale: the blob is authored in space coordinates, and rescaling
    // would stretch away the very expansion this story measures.
    graph.setPointPositions(positions, true)
    graph.setConfigPartial({ simulationGravity: gravity })
    // Alpha back to 1 so the blob expands; 0 duration so the new point set
    // snaps in instead of interpolating from the previous one.
    graph.render(1, 0)
    tick = 0
    readTick = -1
    hasPoints = true
    refresh(true)
  }

  const controls = document.createElement('div')
  controls.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:6px;'
  panel.appendChild(controls)

  // Toggle-style buttons restyle together, so the active size, gravity and run
  // state always read off the panel correctly.
  const painters: (() => void)[] = []
  const repaintButtons = (): void => painters.forEach((paint) => paint())

  const addRow = (): HTMLDivElement => {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;'
    controls.appendChild(row)
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
      // Before `ready` there is nothing to step or reload yet
      if (!hasPoints || disposed) return
      onClick()
      repaintButtons()
    })
    row.appendChild(button)
  }

  const sizeRow = addRow()
  for (const size of SIZES) {
    addButton(sizeRow, `${size / 1000}k points`, () => {
      pointsNumber = size
      loadPoints()
    }, () => pointsNumber === size)
  }

  const gravityRow = addRow()
  for (const value of GRAVITIES) {
    addButton(gravityRow, `gravity ${value}`, () => {
      gravity = value
      loadPoints()
    }, () => gravity === value)
  }

  const actionRow = addRow()
  addButton(actionRow, `step ×${STEPS_PER_BURST}`, () => {
    for (let i = 0; i < STEPS_PER_BURST; i += 1) graph.step()
    refresh(true)
  })
  addButton(actionRow, 'run', () => {
    isRunning = true
    graph.unpause()
    refresh(true)
  }, () => isRunning)
  addButton(actionRow, 'pause', () => {
    isRunning = false
    graph.pause()
    refresh(true)
  }, () => !isRunning)
  addButton(actionRow, 'fit space', () => frameSpace(250))
  // The points, wherever they went: past the space, this is a wider view
  addButton(actionRow, 'fit layout', () => frameLayout(250))

  repaintButtons()

  const refreshTimer = window.setInterval(() => refresh(), READOUT_INTERVAL_MS)

  // Device init is async: until it resolves there is no position texture to
  // load into or read from. Set up off `ready`, never off requestAnimationFrame,
  // which a hidden tab never schedules.
  graph.ready.then(() => {
    if (disposed) return
    loadPoints()
    graph.start()
  }).catch((error: unknown) => {
    readout.textContent = `Failed to initialise: ${String(error)}`
  })

  return {
    graph,
    div,
    destroy: (): void => {
      disposed = true
      window.clearInterval(refreshTimer)
    },
  }
}
