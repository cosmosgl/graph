import type { Graph } from '../../../../../dist/index.js'
import { arrayHash } from './youtube-oracle'

type Marker = { submittedAt: number; completedAt: Promise<number>; pendingFrames: number }
type FrameCost = { submitMs: number; completedMs: number; ticks: number }
export type IsolatedCosts = {
  simulation: FrameCost[];
  pointsAndLinks: FrameCost[];
  pointsOnly: FrameCost[];
}
export type FrozenDraw = {
  tick: number;
  positionsSha256: string;
  coordinates: number;
  highlights: {
    count: number;
    idsSha256: string;
    clear: FrameCost;
    apply: FrameCost;
    toggleOne: FrameCost;
    restoreOne: FrameCost;
  };
  draws: FrameCost[];
}

/** All timestamps use the browser clock when luma acknowledges queued work. */
export class YoutubeQueueProfile {
  private submittedTick: number
  private completedTick: number
  private isAutonomous = true
  private error: unknown

  public constructor (private graph: Graph, private currentTick: () => number) {
    this.submittedTick = this.completedTick = currentTick()
  }

  public mark (): Marker {
    const submittedAt = performance.now()
    const fence = this.graph.simulation.device!.createFence()
    const completedAt = fence.signaled.then(() => performance.now()).finally(() => fence.destroy())
    return { submittedAt, completedAt, pendingFrames: this.submittedTick - this.completedTick }
  }

  public afterStep (tick: number): void {
    if (!this.isAutonomous) return
    // The package submits the draw after the tick callback in this same task.
    queueMicrotask(() => {
      this.submittedTick = tick
      this.mark().completedAt.then(() => { this.completedTick = Math.max(this.completedTick, tick) }, cause => { this.error = cause })
    })
  }

  public async frozenDraw (targetTick: number): Promise<FrozenDraw> {
    const ids = this.graph.config.highlightedPointIndices
    if (!ids) throw new Error('No selection available for the frozen highlight comparison')
    // Start with ordinary point colors in the committed style buffers. The final
    // screenshot must come from applying the highlight through the interactive setter.
    await this.freeze(true)
    if (this.currentTick() > targetTick) throw new Error(`Draw tick ${targetTick} passed before freeze at ${this.currentTick()}`)
    while (this.currentTick() < targetTick) await this.measure(() => this.graph.simulation.step(), 1)
    const xy = await this.graph.getPointPositionsAsync()
    const positionsSha256 = await arrayHash(xy)
    const toggled = ids.length ? ids.slice(1) : [0]
    const setHighlights = (indices: number[] | undefined): Promise<FrameCost> => this.measure(() => {
      this.graph.setConfigPartial({ highlightedPointIndices: indices })
    }, 0)
    const highlights = {
      count: ids.length,
      idsSha256: await arrayHash(Uint32Array.from(ids)),
      apply: await setHighlights(ids),
      toggleOne: await setHighlights(toggled),
      restoreOne: await setHighlights(ids),
      clear: await setHighlights(undefined),
    }
    await setHighlights(ids)
    const draws: FrameCost[] = []
    for (let i = 0; i < 3; i++) draws.push(await this.measure(() => this.graph.renderOneFrame(), 0))
    return { tick: this.currentTick(), coordinates: xy.length, positionsSha256, highlights, draws }
  }

  public async isolatedCosts (): Promise<IsolatedCosts> {
    await this.freeze()
    const costs: IsolatedCosts = { simulation: [], pointsAndLinks: [], pointsOnly: [] }
    // Force one layout tick while paused, then draw the graph at those positions.
    for (let i = 0; i < 3; i++) {
      costs.simulation.push(await this.measure(() => this.graph.simulation.step(), 1))
      costs.pointsAndLinks.push(await this.measure(() => this.graph.renderOneFrame(), 0))
    }
    this.graph.setConfigPartial({ renderLinks: false })
    await this.mark().completedAt
    for (let i = 0; i < 3; i++) costs.pointsOnly.push(await this.measure(() => this.graph.renderOneFrame(), 0))
    return costs
  }

  private async freeze (clearHighlights = false): Promise<void> {
    if (this.error) throw this.error
    this.isAutonomous = false
    this.graph.pause()
    this.graph.setConfigPartial(clearHighlights
      ? { enableRenderLoop: false, highlightedPointIndices: undefined }
      : { enableRenderLoop: false })
    await this.mark().completedAt
  }

  private async measure (submit: () => void, expectedTicks: number): Promise<FrameCost> {
    const tick = this.currentTick()
    const start = performance.now()
    submit()
    const end = this.mark()
    const completed = await end.completedAt
    const ticks = this.currentTick() - tick
    if (ticks !== expectedTicks) throw new Error(`Isolated stage advanced ${ticks} ticks, expected ${expectedTicks}`)
    return { submitMs: end.submittedAt - start, completedMs: completed - start, ticks }
  }
}
