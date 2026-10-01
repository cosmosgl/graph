import type { Device, Framebuffer, Texture } from '@luma.gl/core'
import type { GraphData } from '@/graph/modules/GraphData'
import type { PositionsReadOptions } from '@/graph/simulation'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import { readPixels, isPointAbsent } from '@/graph/helper'
import { PickingReadback } from '@/graph/modules/Points/picking-readback'

/**
 * Follows a set of points — returned by `GraphSimulation.trackPoints()`.
 *
 * The set is declarative: an index follows its point whenever that point exists.
 * Growing or shrinking the point count later keeps tracking correct — an index
 * past the current count simply reports nothing until the count grows to include
 * it. A tracker may be created before the first `setPointPositions` call.
 * Trackers are independent: each follows its own set. A tracker lives until
 * `destroy()` or until its simulation is destroyed; after that its reads are empty.
 */
export interface PointTracker {
  /** The tracked point indices, in the order given. */
  readonly indices: readonly number[];
  /**
   * Current X and Y coordinates of the tracked points. Do not mutate the returned
   * map — it is the tracker's cache until the positions change.
   * @param options Use `{ nonBlocking: true }` to take the latest positions the GPU has handed
   * back without stalling for the current ones.
   * @returns A ReadonlyMap from point index to `[x, y]`. An **absent** tracked point (removed
   * via a `NaN` position — see `setPointPositions`) is omitted — a missing key means "this
   * point is gone"; the entry disappears as soon as the point is removed, even while its
   * fade-out is still playing. An index with no point behind it is omitted the same way.
   * A `nonBlocking` read can be behind on coordinates, never on which points exist: a removed
   * point leaves the map at once, and a point that has just appeared is added once its
   * position has been read.
   */
  positions(options?: PositionsReadOptions): ReadonlyMap<number, [number, number]>;
  /**
   * The same positions as `[x0, y0, x1, y1, …]`, ordered like `indices`. An absent point,
   * or an index with no point behind it, keeps its slot as `NaN`, so the array stays aligned
   * with the indices. Always reads the current positions, so it stalls like
   * `getPointPositionsArray`. Empty when there is nothing to read.
   */
  positionsArray(): number[];
  /** Follows another set of points. */
  setIndices(indices: readonly number[]): void;
  /** Stops tracking and releases the tracker's GPU resources. */
  destroy(): void;
}

/** What a tracker needs from the points module that owns it. @internal */
export interface PointTrackerHost {
  readonly device: Device;
  readonly data: GraphData;
  /** Goes up on every write to the position texture. */
  readonly positionVersion: number;
  /** Goes up when the count or the set of absent points changes. */
  readonly pointListVersion: number;
  /**
   * Asks for a tick that will issue a non-blocking copy; `true` when one is coming.
   * Unset, or `false`, when nothing drives ticks — the read then issues the copy itself.
   */
  requestTick: (() => boolean) | undefined;
  /** Draws the positions of the indices in `table` into `target`; `false` when it could not. */
  gatherTrackedPositions(table: Texture, target: Framebuffer): boolean;
  removeTracker(tracker: PointTrackerImpl): void;
}

/**
 * One tracked set and everything that belongs to it:
 *
 *   currentPositionTexture ──gather()──▶ positionsFbo ──readPixels──▶ cached Map
 *   (source of truth)        (GPU draw)   (GPU cache)    (on demand)   (CPU cache)
 *
 * The points module gathers every tracker after every write to the position
 * texture. What is behind is told by the host's position version: the cache, the
 * gathered target and the copy issued last each remember the version they hold.
 *
 * A non-blocking read may be behind on coordinates, never on which points exist.
 * The cache and the copy in flight also remember the point-list version they were
 * taken under: an older cache drops the points that are gone, and an older copy is
 * discarded, because decoding it against another point list would report points at
 * coordinates they never had.
 * @internal
 */
export class PointTrackerImpl implements PointTracker {
  public indices: readonly number[]

  private host: PointTrackerHost | undefined
  private isDestroyed = false
  /** The raw point indices, one per texel (-1 = unused slot). */
  private indicesTexture: Texture | undefined
  private positionsFbo: Framebuffer | undefined
  /** The position version `positionsFbo` holds. */
  private gatheredVersion = -1
  private cached: Map<number, [number, number]> | undefined
  /** The position version `cached` describes. */
  private cachedVersion = -1
  /** The point-list version `cached` describes. */
  private cachedPointList = -1
  /** Async copy of `positionsFbo` for non-blocking reads. */
  private readback: PickingReadback | undefined
  /** The position version of the copy issued last; a read that blocked counts as one. */
  private issuedVersion = -1
  /** The point-list version of the copy issued last. */
  private issuedPointList = -1
  /**
   * Set by a non-blocking read that returned older positions; the next copy issued
   * clears it, so copies stop when the reads do.
   */
  private isReadbackWanted = false

  public constructor (indices: readonly number[]) {
    this.indices = [...indices]
  }

  /** Whether a non-blocking copy is still awaiting the GPU. */
  public get hasPendingReadback (): boolean {
    return this.readback?.inFlight ?? false
  }

  public positions (options?: PositionsReadOptions): ReadonlyMap<number, [number, number]> {
    const { host } = this
    if (!host || !this.indices.length) return new Map()

    // A copy that has landed is newer than the cache
    this.resolveReadback()
    const version = host.positionVersion
    const pointList = host.pointListVersion
    if (this.cached && this.cachedVersion === version && this.cachedPointList === pointList) return this.cached

    if (options?.nonBlocking && this.cached) {
      // Its coordinates stay as old as they are: only the points that are gone leave
      if (this.cachedPointList !== pointList) this.dropGonePoints()
      this.isReadbackWanted = true
      // A frame issues the copy after its last position write. Ask for one — an idle loop
      // would never run it — and where none can be promised, issue the copy here, or a
      // simulation nobody is stepping would keep these positions for good.
      if (this.issuedVersion !== version && !(host.requestTick?.() ?? false)) this.requestReadback()
      return this.cached
    }

    if (!this.positionsFbo || this.positionsFbo.destroyed) return new Map()

    // A read still in flight holds older positions than the one about to be taken.
    this.isReadbackWanted = false
    this.readback?.cancel()

    // The gather follows every position write, but a read can come first
    // (static graph, or tracking set before data) — gather here when behind.
    this.gather()

    this.cached = this.buildMap(readPixels(host.device, this.positionsFbo))
    this.cachedVersion = version
    this.cachedPointList = pointList
    this.issuedVersion = version
    return this.cached
  }

  // TODO: Accept a `Float32Array` destination. deck.gl takes one as a binary attribute
  // without a copy, and a reused buffer allocates nothing per read.
  public positionsArray (): number[] {
    const { host, indices } = this
    if (!host || !indices.length || !this.positionsFbo || this.positionsFbo.destroyed) return []
    const positions = new Array<number>(indices.length * 2)
    this.gather()
    const pixels = readPixels(host.device, this.positionsFbo)
    for (let i = 0, count = indices.length; i < count; i += 1) {
      const index = indices[i] as number
      // Unlike the map (which omits it), the array keeps the slot of a point that
      // is absent or has no point behind it, so positions stay aligned with the indices.
      const isGone = !host.data.isPointIndex(index) ||
        (host.data.pointPositions !== undefined && isPointAbsent(host.data.pointPositions, index))
      positions[i * 2] = isGone ? NaN : pixels[i * 4] as number
      positions[i * 2 + 1] = isGone ? NaN : pixels[i * 4 + 1] as number
    }
    return positions
  }

  public setIndices (indices: readonly number[]): void {
    this.indices = [...indices]
    this.cached = undefined
    this.cachedVersion = -1
    this.issuedVersion = -1
    this.isReadbackWanted = false
    // The target may be reallocated below; a read in flight targets the old one.
    this.readback?.destroy()
    this.readback = undefined
    this.allocate()
  }

  public destroy (): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    const { host } = this
    this.release()
    host?.removeTracker(this)
  }

  /** Adopted by a points module: `false` when the tracker was destroyed before it arrived. */
  public attach (host: PointTrackerHost): boolean {
    if (this.isDestroyed) return false
    this.host = host
    this.allocate()
    return true
  }

  /** Frees the GPU resources and lets go of the host; the reads are empty from here on. */
  public release (): void {
    this.readback?.destroy()
    this.readback = undefined
    if (this.positionsFbo && !this.positionsFbo.destroyed) this.positionsFbo.destroy()
    this.positionsFbo = undefined
    if (this.indicesTexture && !this.indicesTexture.destroyed) this.indicesTexture.destroy()
    this.indicesTexture = undefined
    this.cached = undefined
    this.host = undefined
  }

  /**
   * Refreshes `positionsFbo` from the current positions: one GPU draw, no CPU sync.
   * Does nothing while the target already holds them.
   */
  public gather (): void {
    const { host } = this
    if (!host || !this.indices.length) return
    if (this.gatheredVersion === host.positionVersion) return
    if (!this.indicesTexture || this.indicesTexture.destroyed) return
    if (!this.positionsFbo || this.positionsFbo.destroyed) return
    if (host.gatherTrackedPositions(this.indicesTexture, this.positionsFbo)) this.gatheredVersion = host.positionVersion
  }

  /**
   * Starts a non-blocking copy for `resolveReadback()` to collect later. Does nothing
   * unless a non-blocking read asked for one and positions changed since the last
   * issue, so it can run at the end of every frame.
   */
  public requestReadback (): void {
    const { host } = this
    if (!host || !this.isReadbackWanted || !this.indices.length) return
    const version = host.positionVersion
    if (this.issuedVersion === version) return
    if (!this.positionsFbo || this.positionsFbo.destroyed) return
    const gl = (host.device as unknown as { gl?: WebGL2RenderingContext }).gl
    const handle = (this.positionsFbo as unknown as { handle?: WebGLFramebuffer }).handle
    if (!gl || !handle) return // non-WebGL backend: the blocking path still works

    this.gather()
    const { width, height } = this.positionsFbo
    this.readback ||= new PickingReadback(gl, width * height * 4)
    // A read still in flight keeps the slot; the flag holds so the next attempt retries.
    if (this.readback.issue(handle, 0, 0, width, height)) {
      this.issuedVersion = version
      this.issuedPointList = host.pointListVersion
      this.isReadbackWanted = false
    }
  }

  /** Caches the positions of a finished `requestReadback()`, if one has finished. */
  public resolveReadback (): void {
    const { host } = this
    if (!host || !this.readback?.inFlight) return
    if (this.issuedPointList !== host.pointListVersion) {
      // A copy of another point list is never decoded. Ask for one of this list.
      this.readback.cancel()
      this.issuedVersion = -1
      this.isReadbackWanted = true
      return
    }
    const pixels = this.readback.poll()
    if (pixels) {
      this.cached = this.buildMap(pixels)
      this.cachedVersion = this.issuedVersion
      this.cachedPointList = this.issuedPointList
    } else if (!this.readback.inFlight) {
      // Fence failed or context lost: the read ended without pixels. Forget the issue
      // so the next non-blocking read issues again instead of waiting for a write.
      this.issuedVersion = -1
    }
  }

  /** (Re)builds the index table and its target for the current set, then gathers. */
  private allocate (): void {
    const { host, indices } = this
    if (!host || !indices.length) return
    const textureSize = Math.ceil(Math.sqrt(indices.length))

    // The table stores raw indices; the shader derives each texel from the
    // positions texture's live width, so a point-count relayout cannot strand
    // the table on the old layout. float32 carries integers exactly to 2^24 —
    // the same ceiling every float-carried index in the engine lives under.
    const table = new Float32Array(textureSize * textureSize * 4).fill(-1)
    for (const [i, index] of indices.entries()) table[i * 4] = index

    if (!this.indicesTexture || this.indicesTexture.destroyed || this.indicesTexture.width !== textureSize) {
      if (this.indicesTexture && !this.indicesTexture.destroyed) this.indicesTexture.destroy()
      this.indicesTexture = host.device.createTexture({ width: textureSize, height: textureSize, format: 'rgba32float' })
    }
    this.indicesTexture.copyImageData({
      data: table,
      bytesPerRow: getBytesPerRow('rgba32float', textureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    if (!this.positionsFbo || this.positionsFbo.destroyed || this.positionsFbo.width !== textureSize) {
      if (this.positionsFbo && !this.positionsFbo.destroyed) this.positionsFbo.destroy()
      this.positionsFbo = host.device.createFramebuffer({
        width: textureSize,
        height: textureSize,
        colorAttachments: ['rgba32float'],
      })
    }
    this.gatheredVersion = -1
    this.gather()
  }

  /** Rebuilds the cache without the points the current point list no longer has. */
  private dropGonePoints (): void {
    const { host, cached } = this
    if (!host || !cached) return
    const live = new Map<number, [number, number]>()
    for (const [index, position] of cached) {
      if (!host.data.isPointIndex(index)) continue
      if (host.data.pointPositions && isPointAbsent(host.data.pointPositions, index)) continue
      live.set(index, position)
    }
    this.cached = live
    this.cachedPointList = host.pointListVersion
  }

  /** Builds the index → position map from a readback of `positionsFbo`. */
  private buildMap (pixels: Float32Array): Map<number, [number, number]> {
    const { host, indices } = this
    const tracked = new Map<number, [number, number]>()
    if (!host) return tracked
    for (let i = 0, count = indices.length; i < count; i += 1) {
      const index = indices[i] as number
      const x = pixels[i * 4]
      const y = pixels[i * 4 + 1]
      if (x === undefined || y === undefined) continue
      // Omit absent (removed) points — the target holds their frozen last
      // coordinate, which must not be reported as a live position. A missing key
      // is the map's way of saying "this point is gone". An index with no point
      // behind it under the current count is omitted the same way, and comes
      // back if the count grows to include it.
      if (!host.data.isPointIndex(index)) continue
      if (host.data.pointPositions && isPointAbsent(host.data.pointPositions, index)) continue
      tracked.set(index, [x, y])
    }
    return tracked
  }
}
