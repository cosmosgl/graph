// Deterministic companion to the 10,000-point story, run in each development preview.
import { Deck, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { GraphSimulation } from '@cosmos.gl/graph'
import { LinksLayer } from './custom-deck-layers/links-layer'
import { PointsLayer } from './custom-deck-layers/points-layer'
import { createStoryDevice } from './story-device'

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()))

type CustomFrame = { xy: number[]; sites: number[][]; picks: ([string, number] | null)[] }

export async function mountCustomDeckCheck (): Promise<{
  adapter: Device['info'];
  step(): void;
  destroy(): void;
  read(): Promise<CustomFrame>;
}> {
  const element = document.createElement('div')
  element.id = 'custom-deck-check'
  element.style.cssText = 'position:relative;width:240px;height:160px;background:#000'
  document.body.append(element)
  const host = await createStoryDevice(element)
  let resolveDevice!: (device: Device) => void
  const ready = new Promise<Device>(resolve => { resolveDevice = resolve })
  const deck = new Deck({
    ...host.props,
    width: 240,
    height: 160,
    useDevicePixels: false,
    onDeviceInitialized: resolveDevice,
    views: new OrthographicView({ flipY: false }),
    initialViewState: { target: [1000, 1000, 0], zoom: 0 },
    layers: [],
  })
  const simulation = new GraphSimulation({
    spaceSize: 2000,
    rescalePositions: false,
    simulationCenter: 0,
    simulationGravity: 1,
    simulationRepulsion: 0,
    simulationLinkSpring: 0,
    simulationFriction: 1,
    simulationDecay: 5000,
  }, ready)
  const destroy = (): void => {
    simulation.destroy()
    deck.finalize()
    host.destroy?.()
    element.remove()
  }
  try {
    simulation.setPointPositions(Float32Array.of(952, 1000, 1048, 1000, NaN, NaN))
    simulation.setPinnedPoints([0])
    simulation.applyData(1)
    simulation.pause()
    await simulation.ready
    const endpoints = Float32Array.of(2, 0, 0, 1)
    const links = new LinksLayer({
      id: 'links',
      positionSource: simulation,
      pickable: true,
      getLinkWidth: 8,
      getLinkColor: [0, 0, 255, 255],
      autoHighlight: true,
      highlightColor: [255, 255, 0, 255],
      data: {
        length: 2,
        attributes: {
          getLinkSource: { value: endpoints, size: 1, stride: 8 },
          getLinkTarget: { value: endpoints, size: 1, offset: 4, stride: 8 },
        },
      },
    })
    const points = new PointsLayer({
      id: 'points',
      positionSource: simulation,
      pickable: true,
      getPointSize: 16,
      autoHighlight: true,
      highlightColor: [255, 255, 0, 255],
      data: {
        length: 3,
        attributes: { getPointColor: { value: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 255, 255), size: 4 } },
      },
    })
    deck.setProps({ layers: [links, points] })
    await nextFrame()
    await nextFrame()
    return {
      adapter: (await ready).info,
      step (): void {
        simulation.setPointPosition(1, 1048, 1050)
        simulation.step()
      },
      async read (): Promise<CustomFrame> {
        // The renderer never reads positions back. The verifier uses its own snapshot to project independent probes.
        const xy = Array.from(await simulation.getPointPositionsAsync())
        const [x0, y0, x1, y1] = xy as [number, number, number, number]
        const viewport = deck.getViewports()[0]!
        const sites = [[x0, y0], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2], [1048, 1000], [900, 940]]
          .map(p => viewport.project(p).slice(0, 2).map(Math.round))
        const picks: ([string, number] | null)[] = []
        deck.redraw('custom layer comparison')
        for (const [x, y] of sites) {
          const info = await deck.pickObjectAsync({ x: x!, y: y!, radius: 0 })
          picks.push(info?.layer ? [info.layer.id, info.index] : null)
        }
        return { xy: xy.slice(0, 4), sites, picks }
      },
      destroy,
    }
  } catch (error) {
    destroy()
    throw error
  }
}
