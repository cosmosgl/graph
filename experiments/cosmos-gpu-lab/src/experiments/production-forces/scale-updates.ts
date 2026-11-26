import type { Graph } from '../../../../../dist/index.js'
import type { ScaleFixture } from './scale-fixture'

/** Time a public edit to its completed draw, then validate the result outside the timed interval. */
export async function measureScaleUpdates (
  graph: Graph, host: HTMLDivElement, fixture: ScaleFixture, read: () => Promise<Float32Array>, sampleMemory: () => void
): Promise<{ point: number; topology: number; replacement: number; resize: number }> {
  const frame = async (): Promise<void> => await new Promise(resolve => requestAnimationFrame(() => resolve()))
  async function measure (change: () => void, ready = (): boolean => true): Promise<number> {
    const start = performance.now()
    change()
    sampleMemory()
    do {
      await frame()
      graph.renderOneFrame()
      if (performance.now() - start > 15000) throw new Error('Timed out waiting for an edit to reach the canvas')
    } while (!ready())
    const fence = graph.simulation.device!.createFence()
    try { await fence.signaled } finally { fence.destroy() }
    await frame()
    sampleMemory()
    return performance.now() - start
  }
  const { positions, links, colors, weights, sizes, linkWidths, linkColors } = fixture
  const nextPositions = positions.slice()
  const nextLinks = links.slice()
  const nextWeights = weights.slice()
  const nextSizes = sizes.slice()
  const nextColors = colors.slice()
  const nextWidths = linkWidths.slice()
  const nextLinkColors = linkColors.slice()
  // Both endpoints are live, and neither is the original source of link 1.
  nextLinks[2] = 0
  const changedX = positions[0] + 64
  const point = await measure(() => graph.setPointPosition(0, changedX, positions[1]))
  if ((await read())[0] !== changedX) throw new Error('Sparse edit did not move the pinned point')
  const endpoints = (): number[] => graph.getConnectedPointIndices(1)
  const original = endpoints()
  const topology = await measure(() => {
    graph.setLinks(nextLinks)
    graph.render(0, 0)
    graph.pause()
  })
  const changed = endpoints()
  if (changed[0] !== 0 || changed[1] !== nextLinks[3]) throw new Error(`Topology replacement returned link 1 as ${changed}`)
  const replacement = await measure(() => {
    graph.setPointPositions(nextPositions, true)
    graph.setPointColors(nextColors)
    graph.setPointSizes(nextSizes)
    graph.setPinnedPoints(fixture.pinned)
    graph.setLinks(links)
    graph.setLinkColors(nextLinkColors)
    graph.setLinkWidths(nextWidths)
    graph.setLinkStrength(nextWeights)
    graph.render(0, 0)
    graph.pause()
  })
  const restored = endpoints()
  const xy = await read()
  if (restored[0] !== original[0] || restored[1] !== original[1] || xy[0] !== nextPositions[0] ||
      xy.length !== nextPositions.length || !Number.isNaN(xy[2]) || !Number.isNaN(xy[3])) throw new Error('Full replacement failed')
  const canvas = host.querySelector('canvas')!
  const resize = await measure(() => {
    host.style.width = '853px'
    host.style.height = '479px'
  }, () => canvas.width === 853 * 2 && canvas.height === 479 * 2)
  return { point, topology, replacement, resize }
}
