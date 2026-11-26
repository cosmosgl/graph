import type { Graph } from '../../../../../dist/index.js'
import type { ScaleFixture } from './scale-fixture'

export type EditPhases = { submit: number; waitToDraw: number; draw: number; fence: number; presentation: number; draws: number }
type Edit = 'point' | 'topology' | 'replacement' | 'resize'

/** Time a public edit to its completed draw, then validate the result outside the timed interval. */
export async function measureScaleUpdates (
  graph: Graph, host: HTMLDivElement, fixture: ScaleFixture, read: () => Promise<Float32Array>, sampleMemory: () => void,
  phases?: Partial<Record<Edit, EditPhases>>
): Promise<Record<Edit, number>> {
  const frame = async (): Promise<void> => await new Promise(resolve => requestAnimationFrame(() => resolve()))
  const waitForDevice = async (): Promise<void> => {
    const fence = graph.simulation.device!.createFence()
    try { await fence.signaled } finally { fence.destroy() }
  }
  async function measure (edit: Edit, change: () => void, ready = (): boolean => true): Promise<number> {
    if (phases) {
      // Empty earlier submissions and start each edit at a fresh display opportunity.
      await waitForDevice()
      await frame()
    }
    const start = performance.now()
    change()
    const submitted = performance.now()
    sampleMemory()
    let draw = 0
    let draws = 0
    do {
      await frame()
      const drawStart = performance.now()
      graph.renderOneFrame()
      draw += performance.now() - drawStart
      draws++
      if (performance.now() - start > 15000) throw new Error('Timed out waiting for an edit to reach the canvas')
    } while (!ready())
    const rendered = performance.now()
    await waitForDevice()
    const completed = performance.now()
    await frame()
    sampleMemory()
    const visible = performance.now()
    if (phases) {
      phases[edit] = {
        submit: submitted - start,
        waitToDraw: rendered - submitted - draw,
        draw,
        draws,
        fence: completed - rendered,
        presentation: visible - completed,
      }
    }
    return visible - start
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
  const point = await measure('point', () => graph.setPointPosition(0, changedX, positions[1]))
  if ((await read())[0] !== changedX) throw new Error('Sparse edit did not move the pinned point')
  const endpoints = (): number[] => graph.getConnectedPointIndices(1)
  const original = endpoints()
  const topology = await measure('topology', () => {
    graph.setLinks(nextLinks)
    graph.render(0, 0)
    graph.pause()
  })
  const changed = endpoints()
  if (changed[0] !== 0 || changed[1] !== nextLinks[3]) throw new Error(`Topology replacement returned link 1 as ${changed}`)
  const replacement = await measure('replacement', () => {
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
  const resize = await measure('resize', () => {
    host.style.width = '853px'
    host.style.height = '479px'
  }, () => canvas.width === 853 * 2 && canvas.height === 479 * 2)
  return { point, topology, replacement, resize }
}
