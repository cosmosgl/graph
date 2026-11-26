import { Deck, OrthographicView } from '@deck.gl/core'
import { Buffer, luma, type Device } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { Graph } from '@cosmos.gl/graph'
import { CosmosGraphLayer, type CosmosGraphLayerConfig, type CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

import { publicContracts } from './contracts'

const query = new URLSearchParams(location.search)
const points = [
  { id: 'left', x: 940, y: 982 },
  { id: 'right', x: 1060, y: 1022 },
]
const links = [{ id: 'edge', source: 'left', target: 'right' }]
// Extra disjoint springs exercise the same checkpoint without covering the three reference pixels.
if (query.get('points') === '65536') {
  for (let i = 2; i < 65536; i++) {
    points.push({ id: String(i), x: 3000 + i % 256, y: 3000 + Math.floor(i / 256) })
    if (i % 2 === 1) links.push({ id: String(i), source: String(i - 1), target: String(i) })
  }
}
const config: CosmosGraphLayerConfig = {
  rescalePositions: false,
  simulationGravity: 0,
  simulationCenter: 0,
  simulationRepulsion: 0,
  simulationLinkSpring: 0,
  pointDefaultSize: 20,
  linkDefaultWidth: 8,
  linkVisibilityMinTransparency: 1,
}
const canvas = document.querySelector('canvas')!
const host = document.querySelector<HTMLElement>('#host')!
const status = document.querySelector<HTMLOutputElement>('#status')!
const resize = document.querySelector<HTMLButtonElement>('#resize')!
const owner = query.get('owner') === 'app' ? 'app' : 'layer'

type Hit = {
  layer?: string;
  kind?: CosmosGraphPickingInfo['elementType'];
  index: number;
  record: string | null;
  originalRecord: boolean;
}
type RemovedGraph = { graphReady: boolean; hasBuffer: boolean; pointAfterEdit: number[] | null }
type View = { target: [number, number, number]; zoom: number }
type Checkpoint = {
  positions: number[];
  view: View;
  width: number;
  height: number;
  selected: number[];
  pins: number[];
  spring: number;
  alpha: number;
  running: boolean;
}
type Recovery = {
  reason: string;
  previousGraphReleased: boolean;
  distinctDevice: boolean;
  restored: Checkpoint;
  mountMs: number;
  firstTickAlpha?: number;
}
type Consumer = {
  adapter: Device['info'];
  contracts: ReturnType<typeof publicContracts>;
  recovery?: Recovery;
  checkpointMovingSession(): Promise<{ checkpoint: Checkpoint; checkpointMs: number; nextTickAlpha: number }>;
  simulateDeviceLoss(): void;
  pauseAndInspect(): Promise<Checkpoint>;
  setSize(width: number, height: number): Promise<void>;
  pick(x: number, y: number): Promise<Hit | null>;
  remove(): Promise<RemovedGraph>;
  finish(): Promise<number[]>;
}

const frame = (): Promise<void> => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
async function until (check: () => boolean, reason: string): Promise<void> {
  const deadline = performance.now() + 15000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(reason)
    await frame()
  }
}

const initial: Checkpoint = {
  positions: points.flatMap(p => [p.x, p.y]),
  view: { target: [1000, 1000, 0], zoom: 0 },
  width: 320,
  height: 192,
  selected: [],
  pins: [],
  spring: 0,
  alpha: 0,
  running: false,
}

function showError (error: unknown): void { status.value = String(error); console.error(error) }

async function mount (
  checkpoint: Checkpoint, previous?: { device: Device; graph: Graph; reason: string }
): Promise<Consumer> {
  const mountStart = performance.now()
  let requestedLoss = false
  // Both Deck and the Graph borrow the application's device.
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    createCanvasContext: { canvas, useDevicePixels: false, alphaMode: 'opaque' },
    onError: error => { console.error(error); return true },
  })
  let saved = checkpoint
  let active = true
  let alpha = checkpoint.alpha
  let ticks = 0
  let recovery: Recovery | undefined
  let recordNextTick: ((value: number) => void) | undefined
  const sessionConfig: CosmosGraphLayerConfig = {
    ...config,
    simulationLinkSpring: checkpoint.spring,
    highlightedPointIndices: checkpoint.selected.length ? checkpoint.selected : undefined,
    pointGreyoutColor: [1, 1, 0, 1],
    onSimulationTick: value => {
      alpha = value
      ticks++
      if (recovery) recovery.firstTickAlpha ??= value
      recordNextTick?.(value)
      recordNextTick = undefined
    },
  }
  let initialized = false
  let renderedFrames = 0
  const deck = new Deck({
    canvas,
    device,
    width: checkpoint.width,
    height: checkpoint.height,
    useDevicePixels: false,
    controller: false,
    views: new OrthographicView({ flipY: false }),
    viewState: checkpoint.view,
    onDeviceInitialized: (d): void => { initialized = d === device },
    onAfterRender: (): void => { renderedFrames++ },
    onError: (error): void => { console.error(error) },
    layers: [],
  })
  await until(() => initialized, 'Deck did not initialize with the supplied device')

  let graph!: Graph
  let layer: CosmosGraphLayer<typeof points[number], typeof links[number]>
  if (owner === 'layer') {
    layer = new CosmosGraphLayer({
      id: 'cosmos',
      pickable: true,
      config: sessionConfig,
      points,
      links,
      getPointId: (p): string => p.id,
      getPointPosition: (_, { index }): [number, number] => [checkpoint.positions[2 * index], checkpoint.positions[2 * index + 1]],
      getPointColor: (p): [number, number, number, number] => p.id === 'left' ? [255, 0, 0, 255] : [0, 255, 0, 255],
      getLinkColor: [0, 0, 255, 255],
      onGraphDataLoaded: ({ graph }): void => graph.pause(),
      onGraphCreated: (created): void => { graph = created },
    })
  } else {
    graph = new Graph(null, sessionConfig, Promise.resolve(device))
    await graph.ready
    graph.setPointPositions(Float32Array.from(checkpoint.positions))
    graph.setPointColors(Float32Array.from(points.flatMap((_, i) => i === 0 ? [1, 0, 0, 1] : [0, 1, 0, 1])))
    graph.setLinks(Float32Array.from({ length: links.length * 2 }, (_, i) => i))
    graph.setLinkColors(Float32Array.from({ length: links.length * 4 }, (_, i) => i % 4 >= 2 ? 1 : 0))
    graph.render(0)
    graph.pause()
    layer = new CosmosGraphLayer({ id: 'cosmos', pickable: true, graph })
  }
  deck.setProps({ layers: [layer] })
  await until(() => layer.isLoaded && graph?.getPointPositionBuffer()?.pointCount === points.length, 'Layer did not load every point')
  graph.pause()
  if (graph.simulation.device !== device) throw new Error('Graph created a second device')
  graph.setPinnedPoints(checkpoint.pins)
  if (previous) graph.render(checkpoint.alpha)
  deck.redraw('first draw')

  async function inspect (): Promise<Checkpoint> {
    const view = deck.getViewports()[0]
    const target = view.position
    const running = graph.isSimulationRunning
    const currentAlpha = alpha
    const positions = Array.from(await graph.getPointPositionsAsync())
    return {
      positions,
      view: { target: [target[0], target[1], target[2]], zoom: view.zoom },
      width: view.width,
      height: view.height,
      selected: [...graph.config.highlightedPointIndices ?? []],
      pins: points.flatMap((_, i) => graph.isPointPinned(i) ? [i] : []),
      spring: graph.config.simulationLinkSpring,
      alpha: currentAlpha,
      running,
    }
  }

  async function pauseAndInspect (): Promise<Checkpoint> {
    const running = graph.isSimulationRunning
    graph.pause()
    deck.redraw('inspect session')
    return { ...await inspect(), running }
  }

  async function pick (x: number, y: number): Promise<Hit | null> {
    const hit = await deck.pickObjectAsync({ x, y, radius: 0 }) as CosmosGraphPickingInfo | null
    if (!hit) return null
    const record = hit.elementType === 'point' ? points[hit.index] : links[hit.index]
    return {
      layer: hit.layer?.id,
      kind: hit.elementType,
      index: hit.index,
      record: hit.object?.id ?? null,
      originalRecord: Boolean(hit.object && hit.object === record),
    }
  }

  async function checkpointMovingSession (): ReturnType<Consumer['checkpointMovingSession']> {
    // Edit the layout and the camera, then select the left point through Deck's picking pass.
    graph.setPointPosition(1, 1082, 1034)
    graph.setPinnedPoint(0, true)
    deck.setProps({ viewState: { target: [1012, 995, 0], zoom: 0.25 } })
    deck.redraw('move camera')
    const [x, y] = deck.getViewports()[0].project([points[0].x, points[0].y])
    const hit = await pick(Math.round(x), Math.round(y))
    if (hit?.kind !== 'point' || hit.index !== 0) throw new Error('Could not select the left point')
    graph.setConfigPartial({ highlightedPointIndices: [hit.index], simulationLinkSpring: 0.05 })
    graph.start(0.45)
    const startTick = ticks
    await until(() => ticks >= startTick + 3, 'Deck did not advance the live graph')
    const checkpointStart = performance.now()
    saved = await pauseAndInspect()
    const checkpointMs = performance.now() - checkpointStart
    let nextTickAlpha: number | undefined
    recordNextTick = (value): void => { nextTickAlpha = value }
    graph.unpause()
    await until(() => nextTickAlpha !== undefined, 'Original session did not continue from the checkpoint')
    return { checkpoint: structuredClone(saved), checkpointMs, nextTickAlpha: nextTickAlpha! }
  }

  // The host owns the device, its camera and the last completed CPU checkpoint.
  // A lost device cannot supply newer positions. Recreate both borrowers on a fresh device.
  if (previous) {
    recovery = {
      reason: previous.reason,
      distinctDevice: device !== previous.device,
      previousGraphReleased: !previous.graph.isReady && !previous.graph.getPointPositionBuffer(),
      restored: await inspect(),
      mountMs: performance.now() - mountStart,
    }
    // The verifier can inspect the restored draw and its pick pass before Deck advances the layout.
    await window.inspectRestoredFrame?.(pick)
    if (checkpoint.running) graph.unpause()
  }
  device.lost.then(info => {
    if (!active || (info.reason === 'destroyed' && !requestedLoss)) return
    active = false
    window.consumer = (async (): Promise<Consumer> => {
      try { deck.finalize() } finally { if (owner === 'app') graph.destroy() }
      return mount(saved, { device, graph, reason: info.reason })
    })()
    window.consumer.catch(showError)
  })

  // Browsers without a GPU-process crash hook can exercise their real device.lost
  // promise by destroying this fixture's own device. Normal teardown does not recover.
  function simulateDeviceLoss (): void {
    requestedLoss = true
    device.destroy()
  }

  async function setSize (width: number, height: number): Promise<void> {
    host.style.width = `${width}px`
    host.style.height = `${height}px`
    deck.setProps({ width, height })
    await until(() => {
      const view = deck.getViewports()[0]
      return canvas.width === width && canvas.height === height && view?.width === width && view.height === height
    }, 'Canvas and Deck viewport did not resize together')
    saved = { ...saved, width, height }
    deck.redraw('resize')
  }

  async function remove (): Promise<RemovedGraph> {
    // Deck applies a new layer list on its animation frame. Let that frame finish
    // before inspecting ownership or touching the app-supplied graph.
    active = false
    const before = renderedFrames
    deck.setProps({ layers: [] })
    await until(() => renderedFrames > before, 'Deck did not render after removing the layer')
    const graphReady = graph.isReady
    const hasBuffer = Boolean(graph.getPointPositionBuffer())
    let pointAfterEdit: number[] | null = null
    if (owner === 'app') {
      graph.setPointPosition(1, 1090, 1040)
      pointAfterEdit = Array.from((await graph.getPointPositionsAsync()).slice(2, 4))
    }
    return { graphReady, hasBuffer, pointAfterEdit }
  }

  async function finish (): Promise<number[]> {
    if (owner === 'app') graph.destroy()
    if (graph.isReady || graph.getPointPositionBuffer()) throw new Error('Graph still owns a position buffer after teardown')
    deck.finalize()
    // A submitted write and readback detect a borrowed device destroyed by either owner.
    const probe = device.createBuffer({ byteLength: 4, usage: Buffer.COPY_DST | Buffer.COPY_SRC })
    try {
      probe.write(new Uint8Array([17, 33, 65, 129]))
      return Array.from(await probe.readAsync())
    } finally {
      probe.destroy()
      device.destroy()
    }
  }

  resize.disabled = false
  resize.onclick = (): Promise<void> => canvas.width === 320 ? setSize(512, 320) : setSize(320, 192)
  status.value = owner === 'app' ? 'App-supplied graph' : 'Layer-owned graph'
  const contracts = publicContracts(deck, graph, until, () => ticks, () => renderedFrames)
  return { adapter: device.info, contracts, recovery, checkpointMovingSession, simulateDeviceLoss, pauseAndInspect, setSize, pick, remove, finish }
}

declare global {
  interface Window {
    consumer: Promise<Consumer>;
    inspectRestoredFrame?: (pick: Consumer['pick']) => Promise<void>;
  }
}
window.consumer = mount(initial)
window.consumer.catch(showError)
