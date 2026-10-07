import { Deck, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { Graph, defaultConfigValues } from '@cosmos.gl/graph'
import type { GraphConfig } from '@cosmos.gl/graph'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'

import { generateMeshData } from '@/graph/stories/generate-mesh-data'
import './style.css'

/**
 * The application owns the graphs; the layers are views of them.
 *
 * Three datasets, each a headless `Graph` on deck's device that the
 * application creates, configures and loads itself — a dense mesh, a
 * fragmented one under strong repulsion, a clustered one. Each has a thumbnail
 * view; a click routes the main view to it. The layers draw without `points`,
 * so they never write into a graph: every dataset keeps its own layout, style
 * and forces, all of them run at once, and the selected one is drawn by two
 * layers yet steps once per frame. Point sizes scale with the view
 * (`scalePointsOnZoom`), so a thumbnail is the main view in small. The actions
 * reach the selected graph through the application's own handle.
 */
export const miniGraphs = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const spaceSize = defaultConfigValues.spaceSize

  const status = document.createElement('div')
  status.className = 'status'
  div.appendChild(status)

  // Three datasets, three thumbnails down the right
  type Recipe = { size: number; wholeness: number; clusters: number; clustered: boolean; forces: GraphConfig }
  const recipes: Recipe[] = [
    { size: 60, wholeness: 1.0, clusters: 8, clustered: false, forces: { simulationGravity: 0.15, simulationRepulsion: 0.5 } },
    { size: 45, wholeness: 0.55, clusters: 3, clustered: false, forces: { simulationGravity: 0.05, simulationRepulsion: 1.5 } },
    { size: 50, wholeness: 0.9, clusters: 12, clustered: true, forces: { simulationGravity: 0.1, simulationRepulsion: 0.4, simulationCluster: 0.4 } },
  ]
  const thumbRect = (i: number): { x: string; y: string; width: string; height: string } =>
    ({ x: '78%', y: `${4 + i * 23}%`, width: '20%', height: '21%' })

  let deck!: Deck<OrthographicView[]>
  const devicePromise = new Promise<Device>((resolve) => {
    deck = new Deck({
      parent: div,
      views: [
        new OrthographicView({ id: 'main', controller: true, flipY: false }),
        // Thumbnails clear their rectangle to the page background, or the main view shows through
        ...recipes.map((_, i) => new OrthographicView({ id: `thumb-${i}`, ...thumbRect(i), flipY: false, clear: true, clearColor: [25, 33, 50, 255] })),
      ],
      initialViewState: {
        main: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -1.6, minZoom: -5, maxZoom: 2 },
        ...Object.fromEntries(recipes.map((_, i) => [`thumb-${i}`, { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -3.6 }])),
      },
      // Each layer belongs to the view its id names
      layerFilter: ({ layer, viewport }) => layer.id.startsWith(viewport.id),
      pickingRadius: 5,
      getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      onDeviceInitialized: resolve,
      layers: [],
    })
  })

  // The application's graphs — their own data, style and forces, never touched by a layer
  type Dataset = { name: string; graph: Graph; isPaused: boolean; frame: HTMLDivElement }
  const datasets = recipes.map((recipe, index): Dataset => {
    const data = generateMeshData(recipe.size, recipe.size, recipe.clusters, recipe.wholeness)
    const graph = new Graph(null, {
      spaceSize,
      simulationLinkDistance: 1,
      simulationLinkSpring: 2,
      simulationFriction: 0.7,
      simulationDecay: 1000,
      ...recipe.forces,
      // Sizes follow the zoom, so the thumbnails show the main view in small
      scalePointsOnZoom: true,
      pointDefaultSize: 4,
      linkDefaultColor: 'rgba(94, 115, 194, 0.25)',
      onSimulationEnd: (): void => setStatus(),
    }, devicePromise)
    graph.setPointPositions(data.pointPositions)
    graph.setPointColors(data.pointColors) // cosmos's 0..1 floats, as the generator makes them
    graph.setLinks(data.links)
    if (recipe.clustered) {
      graph.setPointClusters(data.pointClusters)
      graph.setClusterPositions(data.clusterPositions)
    }
    graph.render()

    // The frame over the thumbnail view: its label, its border, and its click target
    const frame = document.createElement('div')
    frame.className = 'thumbnail'
    const rect = thumbRect(index)
    frame.style.cssText = `left: ${rect.x}; top: ${rect.y}; width: ${rect.width}; height: ${rect.height};`
    div.appendChild(frame)
    const dataset: Dataset = { name: String.fromCharCode(65 + index), graph, isPaused: false, frame }
    frame.addEventListener('click', () => { select(dataset) })
    return dataset
  })
  let current = datasets[0] as Dataset

  // One layer per thumbnail and one for the main view, all without `points`
  const graphLayer = (id: string, dataset: Dataset): CosmosGraphLayer =>
    new CosmosGraphLayer({ id, graph: dataset.graph, pickable: id === 'main', autoHighlight: id === 'main', enablePointDrag: id === 'main' })

  const stateOf = (dataset: Dataset): string =>
    dataset.graph.isSimulationRunning ? 'running' : dataset.isPaused ? 'paused' : 'settled'
  const setStatus = (): void => {
    status.textContent = `dataset ${current.name} · ${stateOf(current)}`
    for (const dataset of datasets) {
      dataset.frame.textContent = `${dataset.name} · ${stateOf(dataset)}`
      dataset.frame.classList.toggle('selected', dataset === current)
    }
  }
  const select = (dataset: Dataset): void => {
    current = dataset
    pauseAction.textContent = dataset.isPaused ? 'Start' : 'Pause'
    deck.setProps({
      layers: [
        ...datasets.map((each, i) => graphLayer(`thumb-${i}`, each)),
        graphLayer('main', current),
      ],
    })
    setStatus()
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
    const { graph } = current
    if (graph.isSimulationRunning) {
      graph.pause()
      current.isPaused = true
      pauseAction.textContent = 'Start'
    } else {
      graph.unpause()
      current.isPaused = false
      pauseAction.textContent = 'Pause'
    }
    setStatus()
  })
  makeAction('Reheat', () => {
    current.graph.start(0.3)
    current.isPaused = false
    pauseAction.textContent = 'Pause'
    setStatus()
  })
  div.appendChild(actions)

  // The graphs draw once they run on deck's device
  await Promise.all(datasets.map(({ graph }) => graph.ready))
  select(current)
  // The thumbnails report their state as the simulations settle on their own
  const ticker = window.setInterval(setStatus, 500)

  return {
    div,
    destroy: (): void => {
      window.clearInterval(ticker)
      // Teardown order: the graphs first, the device belongs to deck
      for (const { graph } of datasets) graph.destroy()
      deck.finalize()
    },
  }
}
