import { Deck, OrthographicView } from '@deck.gl/core'
import type { Graph } from '@cosmos.gl/graph'
import { CosmosGraphLayer, type CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

type Wait = (condition: () => boolean, reason: string) => Promise<void>
type Box = ReturnType<CosmosGraphLayer['getBounds']>

type Hit = { layer?: string; kind?: CosmosGraphPickingInfo['elementType']; index: number } | null
type DragEvent = { phase: string; id: number; viewport?: string; pinned: boolean; screen: number[] }
type DragState = { events: DragEvent[]; pinned: boolean; position: number[] }
type SharedResult = {
  shared: boolean; steps: number[]; before: Hit[]; after: Hit[]; initial: number[]; both: number[]; one: number[]; appGraphAlive: boolean;
}
type BoundsResult = {
  oldPositions?: number[]; during: Box; fresh: Box; pendingReads: number; settledReads: number; cachedReads: number; heldSteps: number; resumedSteps: number;
}
type PublicContracts = {
  sharedTimeline(): Promise<SharedResult>;
  prepareDrag(view: 'main' | 'thumbnail'): Promise<Hit>;
  waitForDrag(phase: string): Promise<void>;
  pick(view: string, x: number, y: number): Promise<Hit>;
  dragState(): Promise<DragState>;
  reloadBounds(rejectOld: boolean): Promise<BoundsResult>;
}

export function publicContracts (deck: Deck<OrthographicView>, graph: Graph, until: Wait, ticks: () => number, frames: () => number): PublicContracts {
  const dragEvents: DragEvent[] = []
  const dragEvent = (phase: string): ((info: CosmosGraphPickingInfo) => void) => (info: CosmosGraphPickingInfo): void => {
    dragEvents.push({ phase, id: info.index, viewport: info.viewport?.id, pinned: graph.isPointPinned(info.index), screen: [info.x, info.y] })
  }
  async function pick (layer: string, x: number, y: number): Promise<Hit> {
    const info = await deck.pickObjectAsync({ x, y, radius: 0, layerIds: [layer] }) as CosmosGraphPickingInfo | null
    return info ? { layer: info.layer?.id, kind: info.elementType, index: info.index } : null
  }

  async function sharedTimeline (): Promise<SharedResult> {
    const main = new CosmosGraphLayer({ id: 'main', graph, pickable: true })
    const second = new CosmosGraphLayer({ id: 'second', graph, pickable: true })
    deck.setProps({ layers: [main, second] })
    await until(() => main.isLoaded && second.isLoaded, 'Both layers must adopt the app Graph')
    const timeline = main.context.timeline
    const shared = timeline === second.context.timeline && main.context.device === second.context.device &&
      main.context.device === graph.simulation.device
    timeline.pause()
    graph.setConfigPartial({ simulationGravity: 0.1, simulationDecay: 100000 })
    graph.setPinnedPoints([0])
    graph.start(1)
    const steps: number[] = []
    const tick = (time: number): void => {
      const before = ticks()
      timeline.setTime(time)
      steps.push(ticks() - before)
    }
    const before = [await pick('main', 100, 114), await pick('second', 100, 114)]
    const initial = Array.from(await graph.getPointPositionsAsync())
    for (const time of [101, 101, 202, 202]) tick(time)
    const both = Array.from(await graph.getPointPositionsAsync())
    const previousFrame = frames()
    deck.setProps({ layers: [second] })
    // A forced redraw can paint the previous layer list before Deck applies setProps.
    await until(() => frames() > previousFrame, 'Deck must paint after removing the first layer')
    for (const time of [303, 303, 404, 404]) tick(time)
    const one = Array.from(await graph.getPointPositionsAsync())
    const after = [await pick('main', 100, 114), await pick('second', 100, 114)]
    const lastFrame = frames()
    deck.setProps({ layers: [] })
    await until(() => frames() > lastFrame, 'Deck must paint the empty layer list')
    tick(505)
    return { shared, steps, before, after, initial, both, one, appGraphAlive: graph.isReady }
  }

  async function prepareDrag (view: 'main' | 'thumbnail'): Promise<Hit> {
    const dragProps = {
      graph,
      pickable: true,
      enablePointDrag: true,
      dragReheatAlpha: null,
      onPointDragStart: dragEvent('start'),
      onPointDrag: dragEvent('move'),
      onPointDragEnd: dragEvent('end'),
    }
    const main = new CosmosGraphLayer({ ...dragProps, id: 'main' })
    const thumbnail = new CosmosGraphLayer({ ...dragProps, id: 'thumbnail' })
    const views = [
      new OrthographicView({ id: 'main', flipY: false }),
      new OrthographicView({ id: 'thumbnail', x: 210, y: 0, width: 100, height: 80, flipY: false }),
    ]
    // Deck permits replacing its single view with several views through setProps.
    const multiView = deck as unknown as Deck<OrthographicView[]>
    multiView.setProps({
      views,
      viewState: { main: { target: [1000, 1000, 0], zoom: 0 }, thumbnail: { target: [1000, 1000, 0], zoom: -2 } },
      layerFilter: ({ layer, viewport }) => layer.id === viewport.id,
      layers: [main, thumbnail],
    })
    await until(() => main.isLoaded && thumbnail.isLoaded && deck.getViewports().length === 2, 'Both drag viewports must load')
    return view === 'main' ? pick(view, 100, 114) : pick(view, 245, 45)
  }

  function waitForDrag (phase: string): Promise<void> {
    return until(() => dragEvents.some(event => event.phase === phase), `Missing drag ${phase}`)
  }

  async function dragState (): Promise<DragState> {
    return { events: [...dragEvents], pinned: graph.isPointPinned(0), position: Array.from((await graph.getPointPositionsAsync()).slice(0, 2)) }
  }

  async function reloadBounds (rejectOld: boolean): Promise<BoundsResult> {
    // Hold the delivery of a real GPU read so a two-point graph crosses the reload
    // deterministically. On rejection the next read still uses the actual device.
    const read = graph.getPointPositionsAsync
    let reads = 0
    let oldPositions: number[] | undefined
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    graph.getPointPositionsAsync = async (...args): Promise<Float32Array> => {
      const first = ++reads === 1
      const xy = await read.apply(graph, args)
      if (first) {
        oldPositions = Array.from(xy)
        await gate
        if (rejectOld) throw new Error('Injected delivery failure after dataset replacement')
      }
      return xy
    }
    let loaded = 0
    const load = (xy: number[]): CosmosGraphLayer => new CosmosGraphLayer({
      id: 'cosmos',
      points: { length: xy.length / 2, initialPositions: Float32Array.from(xy) },
      config: {
        rescalePositions: false,
        simulationGravity: 0,
        simulationRepulsion: 0,
        simulationCenter: 0,
        simulationLinkSpring: 0,
        onSimulationTick: graph.config.onSimulationTick,
      },
      onGraphDataLoaded: (): void => { graph.pause(); loaded++ },
    })
    const originalAfterRender = deck.props.onAfterRender
    let layer = load([0, 0, 100, 50])
    let box: Box = null
    const second = new CosmosGraphLayer({ id: 'also-draws', graph })
    try {
      deck.setProps({ layers: [layer, second] })
      await until(() => loaded === 1 && layer.isLoaded && second.isLoaded, 'Both layers must load the original dataset')
      const timeline = layer.context.timeline
      timeline.pause()
      deck.setProps({
        onAfterRender: (...args): void => {
          originalAfterRender?.(...args)
          if (layer.isLoaded) box = layer.getBounds()
        },
      })
      await until(() => oldPositions !== undefined, 'A visible frame must request the original bounds')
      graph.start(1)
      const before = ticks()
      timeline.setTime(101)
      timeline.setTime(202)
      const heldSteps = ticks() - before
      graph.pause()
      layer = load([5000, 5000, 5100, 5050])
      deck.setProps({ layers: [layer, second] })
      await until(() => loaded === 2 && layer.isLoaded, 'The new points must load while the old read is pending')
      const during = layer.getBounds()
      const pendingReads = reads
      graph.setPointPosition(0, 4900, 4950)
      release()
      // Only normal frames call getBounds here; the read completion must request
      // another frame for the fresh measurement even when the simulation is paused.
      await until(() => box?.[0]?.[0] === 4900, 'Deck must display measured bounds for the replacement data')
      const fresh = box
      const settledReads = reads
      for (let i = 0; i < 5; i++) layer.getBounds()
      const cachedReads = reads
      graph.start(1)
      const resumeAt = ticks()
      timeline.setTime(303)
      graph.pause()
      return { oldPositions, during, fresh, pendingReads, settledReads, cachedReads, heldSteps, resumedSteps: ticks() - resumeAt }
    } finally {
      release()
      deck.setProps({ onAfterRender: originalAfterRender })
      graph.getPointPositionsAsync = read
    }
  }

  return { sharedTimeline, prepareDrag, waitForDrag, dragState, pick, reloadBounds }
}
