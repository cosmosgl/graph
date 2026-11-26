import type { PositionsReadOptions } from '@/graph/simulation'
import type { GraphSimulation } from '../../simulation'

type Positions = ReadonlyMap<number, [number, number]>

/** One independently editable set of point indices followed by a WebGPU simulation. */
export interface PointTracker {
  /** The requested indices, including duplicates and slots that do not currently exist. */
  readonly indices: readonly number[];
  /**
   * The last completed map in requested order, omitting absent and out-of-range points.
   * Both read modes return without waiting. A read starts a gather when newer positions are available.
   */
  positions(options?: PositionsReadOptions): Positions;
  /** Capture positions at the call. A change of indices or point membership, disposal or device loss invalidates a pending read with null. */
  positionsAsync(): Promise<Positions | null>;
  /** The completed snapshot in indices order, with NaN pairs for missing positions. */
  positionsArray(): number[];
  /** Follow a different set and discard the previous set's cached and pending answers. */
  setIndices(indices: readonly number[]): void;
  /** Release this tracker. Subsequent reads are empty. */
  destroy(): void;
}

/** @internal Each gather uses the simulation's indexed kernel and captures its current GPU buffer before yielding. */
export class PointTrackerImpl implements PointTracker {
  public indices: readonly number[]
  private cached: Positions = new Map()
  private cachedVersion = -1
  private generation = 0
  private pending?: { version: number; promise: Promise<Positions | null> }

  public constructor (
    indices: readonly number[], private simulation?: GraphSimulation, private unregister?: () => void
  ) {
    this.indices = [...indices]
  }

  public positions (): Positions {
    const version = this.simulation?.getPointPositionBuffer()?.version
    if (version !== undefined && version !== this.cachedVersion && this.indices.length && !this.pending) {
      this.positionsAsync().catch(error => console.error(error))
    }
    return this.cached
  }

  public positionsArray (): number[] {
    if (!this.simulation?.isReady) return []
    const positions = this.positions()
    return this.indices.flatMap(id => positions.get(id) ?? [NaN, NaN])
  }

  public positionsAsync (): Promise<Positions | null> {
    const { simulation, indices, generation } = this
    const version = simulation?.getPointPositionBuffer()?.version
    if (!simulation || version === undefined || !indices.length) return Promise.resolve(new Map())
    if (this.pending?.version === version) return this.pending.promise

    const current = (): boolean => this.generation === generation && simulation.isReady && !simulation.device?.isLost
    const promise = simulation.getPointPositionsByIndicesAsync(indices).then(xy => {
      if (!current()) return null
      const result = new Map<number, [number, number]>()
      for (const [i, id] of indices.entries()) {
        const x = xy[i * 2]!
        const y = xy[i * 2 + 1]!
        if (Number.isFinite(x) && Number.isFinite(y)) result.set(id, [x, y])
      }
      // Copies requested at different ticks may complete out of order.
      if (version >= this.cachedVersion) { this.cached = result; this.cachedVersion = version }
      return result
    }).catch(error => {
      if (!current()) return null
      throw error
    }).finally(() => { if (this.pending?.promise === promise) this.pending = undefined })
    this.pending = { version, promise }
    return promise
  }

  public setIndices (indices: readonly number[]): void {
    // Graph can reset its read cache after a sparse edit without copying the tracked ID list.
    if (indices !== this.indices) this.indices = [...indices]
    this.invalidate(new Map())
  }

  /** Keep coordinates for survivors. A removed slot must disappear even if it is revived before the next read. */
  public pointListChanged (present: (id: number) => boolean): void {
    this.invalidate(new Map([...this.cached].filter(([id]) => present(id))))
  }

  public destroy (): void {
    this.unregister?.()
    this.unregister = undefined
    this.simulation = undefined
    this.invalidate(new Map())
  }

  private invalidate (cache: Positions): void {
    this.generation++
    this.pending = undefined
    this.cachedVersion = -1
    this.cached = cache
  }
}
