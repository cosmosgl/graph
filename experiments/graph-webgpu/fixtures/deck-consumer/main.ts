import { Deck, OrthographicView } from '@deck.gl/core'
import { Buffer, luma, type Device } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { Graph } from '@cosmos.gl/graph'
import { CosmosGraphLayer, type CosmosGraphLayerConfig, type CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

const points = [
  { id: 'left', x: 940, y: 982 },
  { id: 'right', x: 1060, y: 1022 },
]
const links = [{ id: 'edge', source: 'left', target: 'right' }]
const positions = Float32Array.from(points.flatMap(p => [p.x, p.y]))
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
const owner = new URLSearchParams(location.search).get('owner') === 'app' ? 'app' : 'layer'

type Hit = {
  layer?: string;
  kind?: CosmosGraphPickingInfo['elementType'];
  index: number;
  record: string | null;
  originalRecord: boolean;
}
type RemovedGraph = { graphReady: boolean; hasBuffer: boolean; pointAfterEdit: number[] | null }
type Consumer = {
  adapter: Device['info'];
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

async function mount (): Promise<Consumer> {
  // Both Deck and the Graph borrow the application's device.
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    createCanvasContext: { canvas, useDevicePixels: false, alphaMode: 'opaque' },
    onError: error => { console.error(error); return true },
  })
  let initialized = false
  let renderedFrames = 0
  const deck = new Deck({
    canvas,
    device,
    width: 320,
    height: 192,
    useDevicePixels: false,
    controller: false,
    views: new OrthographicView({ flipY: false }),
    viewState: { target: [1000, 1000, 0], zoom: 0 },
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
      config,
      points,
      links,
      getPointId: (p): string => p.id,
      getPointPosition: (p): [number, number] => [p.x, p.y],
      getPointColor: (p): [number, number, number, number] => p.id === 'left' ? [255, 0, 0, 255] : [0, 255, 0, 255],
      getLinkColor: [0, 0, 255, 255],
      onGraphCreated: (created): void => { graph = created },
    })
  } else {
    graph = new Graph(null, config, Promise.resolve(device))
    await graph.ready
    graph.setPointPositions(positions)
    graph.setPointColors(new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]))
    graph.setLinks(new Float32Array([0, 1]))
    graph.setLinkColors(new Float32Array([0, 0, 1, 1]))
    graph.render(0)
    layer = new CosmosGraphLayer({ id: 'cosmos', pickable: true, graph })
  }
  deck.setProps({ layers: [layer] })
  await until(() => layer.isLoaded && graph?.getPointPositionBuffer()?.pointCount === 2, 'Layer did not load both points')
  graph.pause()
  if (graph.simulation.device !== device) throw new Error('Graph created a second device')
  deck.redraw('first draw')

  async function setSize (width: number, height: number): Promise<void> {
    host.style.width = `${width}px`
    host.style.height = `${height}px`
    deck.setProps({ width, height })
    await until(() => {
      const view = deck.getViewports()[0]
      return canvas.width === width && canvas.height === height && view?.width === width && view.height === height
    }, 'Canvas and Deck viewport did not resize together')
    deck.redraw('resize')
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

  async function remove (): Promise<RemovedGraph> {
    // Deck applies a new layer list on its animation frame. Let that frame finish
    // before inspecting ownership or touching the app-supplied graph.
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
  return { adapter: device.info, setSize, pick, remove, finish }
}

declare global { interface Window { consumer: Promise<Consumer> } }
window.consumer = mount()
window.consumer.catch(error => { status.value = String(error); console.error(error) })
