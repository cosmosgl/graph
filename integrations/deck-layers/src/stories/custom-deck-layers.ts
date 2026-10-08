import { Deck, OrthographicView } from '@deck.gl/core'
import type { PickingInfo } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { GraphSimulation, defaultConfigValues } from '@cosmos.gl/graph'
import type { GraphSimulationConfig } from '@cosmos.gl/graph'

import { generateMeshData } from '@/graph/stories/generate-mesh-data'
import { PointsLayer } from './custom-deck-layers/points-layer'
import { LinksLayer } from './custom-deck-layers/links-layer'
import './style.css'

/**
 * A renderer of your own over the live position texture.
 *
 * `CosmosGraphLayer` draws with cosmos.gl's renderer. This story draws with two deck
 * layers written for the purpose — the sources are in the panes — over a standalone
 * `GraphSimulation` on deck's device. Each layer `texelFetch`es the simulation's
 * position texture by instance index (`PositionTextureSource`), so positions never
 * leave the GPU, and the rest is ordinary deck: binary attributes for color and size,
 * `pickable` with hover and `autoHighlight`, and a drag that pins the grabbed point
 * and moves it through `setPointPosition`. The frame loop is the application's too:
 * deck's `_animate` follows the simulation's run state, and `onBeforeRender` steps it.
 * What you give up is cosmos.gl's rendering — shapes, arrows, dashes — and what you
 * gain is deck's attribute pipeline: transitions, extensions, `highlightColor`.
 */
export const customDeckLayers = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const data = generateMeshData(100, 100, 25, 1.0)
  const pointCount = data.pointPositions.length / 2
  const linkCount = data.links.length / 2
  const spaceSize = defaultConfigValues.spaceSize
  // cosmos channels are 0..1 floats; the deck attributes here take 0..255 bytes
  const pointColors = Uint8Array.from(data.pointColors, (channel) => channel * 255)
  const linkColors = Uint8Array.from(data.linkColors, (channel, i) => (i % 4 === 3 ? 0.25 : channel) * 255)

  const hover = document.createElement('div')
  hover.className = 'hover'
  hover.textContent = 'hover to see the picked element'
  div.appendChild(hover)
  const status = document.createElement('div')
  status.className = 'status'
  div.appendChild(status)

  let deck!: Deck<OrthographicView>
  const devicePromise = new Promise<Device>((resolve) => {
    deck = new Deck({
      parent: div,
      views: new OrthographicView(),
      initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2, minZoom: -5, maxZoom: 2 },
      controller: true,
      pickingRadius: 5,
      getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      // deck draws a frame only when asked: while the simulation runs, every frame
      _animate: true,
      onDeviceInitialized: resolve,
      layers: [],
    })
  })

  const config: GraphSimulationConfig = {
    spaceSize,
    simulationGravity: 0.15,
    simulationRepulsion: 0.5,
    simulationLinkDistance: 1,
    simulationLinkSpring: 2,
    simulationFriction: 0.7,
    simulationDecay: 5000,
    // The frame loop follows the simulation: frames while it runs, idle when it rests
    onSimulationStart: (): void => deck.setProps({ _animate: true }),
    onSimulationUnpause: (): void => deck.setProps({ _animate: true }),
    onSimulationPause: (): void => deck.setProps({ _animate: false }),
    onSimulationEnd: (): void => {
      deck.setProps({ _animate: false })
      setStatus()
    },
  }
  // The simulation alone: no rendering of its own, on deck's device
  const simulation = new GraphSimulation(config, devicePromise)
  simulation.setPointPositions(data.pointPositions)
  simulation.setLinks(data.links)
  simulation.applyData()

  // A drag pins the point, moves it with the pointer, and lets it go
  let dragged: number | null = null
  const stopPanning = (event: { stopImmediatePropagation?: () => void }): void => { event.stopImmediatePropagation?.() }

  const layers = (): (PointsLayer | LinksLayer)[] => [
    new LinksLayer({
      id: 'links',
      positionSource: simulation,
      // The pair array, read in place as two interleaved attributes
      data: {
        length: linkCount,
        attributes: {
          getLinkSource: { value: data.links, size: 1, stride: 8 },
          getLinkTarget: { value: data.links, size: 1, offset: 4, stride: 8 },
          getLinkColor: { value: linkColors, size: 4 },
          getLinkWidth: { value: data.linkWidths, size: 1 },
        },
      },
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 200],
      onHover: (info: PickingInfo): void => { if (info.index >= 0) hover.textContent = `link ${info.index}` },
    }),
    new PointsLayer({
      id: 'points',
      positionSource: simulation,
      data: {
        length: pointCount,
        attributes: {
          getPointColor: { value: pointColors, size: 4 },
          getPointSize: { value: data.pointSizes, size: 1 },
        },
      },
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 240],
      onHover: (info: PickingInfo): void => {
        hover.textContent = info.index >= 0 ? `point ${info.index}` : 'hover to see the picked element'
      },
      onDragStart: (info, event): boolean => {
        if (info.index < 0) return false
        dragged = info.index
        simulation.setPinnedPoint(dragged, true)
        simulation.start(0.1)
        stopPanning(event)
        return true
      },
      onDrag: (info, event): boolean => {
        if (dragged === null || !info.coordinate) return false
        simulation.setPointPosition(dragged, info.coordinate[0] as number, info.coordinate[1] as number)
        stopPanning(event)
        deck.redraw()
        return true
      },
      onDragEnd: (_, event): boolean => {
        if (dragged === null) return false
        simulation.setPinnedPoint(dragged, false)
        dragged = null
        stopPanning(event)
        return true
      },
    }),
  ]

  let isPaused = false
  const setStatus = (): void => {
    const state = simulation.isSimulationRunning ? 'running' : isPaused ? 'paused' : 'settled'
    status.textContent = `${pointCount.toLocaleString()} points · ${linkCount.toLocaleString()} links · custom deck layers · ${state}`
  }

  const actions = document.createElement('div')
  actions.className = 'actions'
  const actionsHeader = document.createElement('div')
  actionsHeader.className = 'actions-header'
  actionsHeader.textContent = 'Actions'
  actions.appendChild(actionsHeader)
  const makeAction = (label: string, onClick: () => void): HTMLDivElement => {
    const action = document.createElement('div')
    action.className = 'action'
    action.textContent = label
    action.addEventListener('click', onClick)
    actions.appendChild(action)
    return action
  }
  const pauseAction = makeAction('Pause', () => {
    if (simulation.isSimulationRunning) {
      simulation.pause()
      isPaused = true
      pauseAction.textContent = 'Start'
    } else {
      simulation.unpause()
      isPaused = false
      pauseAction.textContent = 'Pause'
    }
    setStatus()
  })
  makeAction('Reheat', () => {
    simulation.start()
    isPaused = false
    pauseAction.textContent = 'Pause'
    setStatus()
  })
  div.appendChild(actions)

  await simulation.ready
  deck.setProps({
    // The application steps the simulation: one step per frame while it runs
    onBeforeRender: (): void => {
      if (simulation.isSimulationRunning) simulation.step()
    },
    layers: layers(),
  })
  setStatus()
  const ticker = window.setInterval(setStatus, 500)

  return {
    div,
    destroy: (): void => {
      window.clearInterval(ticker)
      // The device belongs to deck: the simulation goes first
      simulation.destroy()
      deck.finalize()
    },
  }
}
