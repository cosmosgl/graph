import { resourceScope } from '../../gpu/resource-scope'
import type { PositionSource } from '../many-body/backend'
import { createSelectionWebGPU } from '../selection/backend'
import type { Camera, Pair, Query } from '../selection/reference'
import type { createRenderer } from './renderer'
import { createTrackedPoints, type TrackedPositions } from './tracked-points'

type Snapshot = { tick: number; revision: number; generation: number }
export type AreaSnapshot = Snapshot & { ids: number[] }
export type TrackedSnapshot = Snapshot & TrackedPositions & { indices: readonly number[] }

export type ViewerReadback = {
  readonly error: string;
  /** Capture the current geometry, styles and camera using top-left canvas CSS coordinates. */
  selectArea(query: Query): Promise<AreaSnapshot | null>;
  setTrackedIndices(indices: readonly number[]): void;
  /** Capture current positions without publishing an older result to the moving-label cache. */
  readTrackedPositions(): Promise<TrackedSnapshot | null>;
  /** Return immediately. Coordinates may trail movement, but a removed ID is hidden at once. */
  latestTrackedPositions(): TrackedSnapshot | null;
}

export async function createIntegratedReadback (
  positions: () => PositionSource, canvas: HTMLCanvasElement,
  drawing: Pick<ReturnType<typeof createRenderer>, 'camera' | 'ratio' | 'styleSource'>,
  tick: () => number, initial: Float32Array
): Promise<{
  api: ViewerReadback;
  moved(): void;
  patched(first: number, data: Float32Array): void;
  beginReplacement(): void;
  endReplacement(data?: Float32Array): void;
  destroy(): void;
}> {
  const { device } = positions(); const scope = resourceScope()
  try {
    const area = scope.own(await createSelectionWebGPU(device)); const tracker = scope.own(await createTrackedPoints(device))
    const absent = new Set<number>()
    let indices: readonly number[] = []; let latest: TrackedSnapshot | null = null
    let generation = 0; let revision = 0; let trackVersion = 0
    let pending = false; let replacing = false; let destroyed = false; let error = ''
    const usable = (): boolean => !destroyed && !replacing && !device.isLost
    const stamp = (): Snapshot => ({ tick: tick(), revision, generation })
    const current = (snapshot: Snapshot): boolean => usable() && snapshot.generation === generation
    const updatePresence = (first: number, data: Float32Array): boolean => {
      let changed = false
      for (let i = 0; i < data.length; i += 4) {
        const id = first + i / 4
        const missing = data[i + 3] > 0.5
        if (absent.has(id) === missing) continue
        if (missing) absent.add(id)
        else absent.delete(id)
        changed = true
      }
      return changed
    }
    updatePresence(0, initial)

    const readTrackedPositions = async (): Promise<TrackedSnapshot | null> => {
      if (!usable()) return null
      const snapshot = stamp(); const requested = indices; const version = trackVersion
      try {
        const gathered = await tracker.read(positions(), requested)
        return current(snapshot) && version === trackVersion ? { ...snapshot, indices: requested, ...gathered } : null
      } catch (cause) {
        if (!current(snapshot) || version !== trackVersion) return null
        throw cause
      }
    }

    const refresh = (): void => {
      if (!usable() || !indices.length || pending || latest?.revision === revision) return
      const requestedRevision = revision
      pending = true
      readTrackedPositions().then(snapshot => {
        if (snapshot) { latest = snapshot; error = '' }
      }).catch(cause => {
        if (usable()) error = String(cause)
      }).finally(() => {
        pending = false
        // Coalesce any writes during the map into one gather of the newest state.
        if (requestedRevision !== revision) refresh()
      })
    }
    const moved = (): void => { revision++; refresh() }
    return {
      api: {
        async selectArea (query): Promise<AreaSnapshot | null> {
          if (!usable()) return null
          const snapshot = stamp()
          const { x, y, zoom } = drawing.camera; const ratio = drawing.ratio
          const viewport: Pair = [canvas.width / ratio, canvas.height / ratio]
          const bounds = canvas.getBoundingClientRect()
          const toLogical = ([x, y]: Pair): Pair => [
            x * viewport[0] / (bounds.width || viewport[0]), y * viewport[1] / (bounds.height || viewport[1]),
          ]
          const logicalQuery = 'rect' in query
            ? { rect: [toLogical(query.rect[0]), toLogical(query.rect[1])] as [Pair, Pair] }
            : { polygon: query.polygon.map(toLogical) }
          const camera: Camera = { origin: [x, y], viewport, translation: [0, 0], zoom, ratio, sizeScale: 1, maxSize: 64, scaleOnZoom: false }
          try {
            const ids = await area.selectResident(positions(), drawing.styleSource, camera, logicalQuery)
            return current(snapshot) ? { ...snapshot, ids } : null
          } catch (cause) {
            if (!current(snapshot)) return null
            throw cause
          }
        },
        setTrackedIndices (next): void {
          if (destroyed) return
          indices = Object.freeze([...next]); trackVersion++; latest = null; moved()
        },
        readTrackedPositions,
        latestTrackedPositions: (): TrackedSnapshot | null => usable() ? latest : null,
        get error (): string { return error },
      },
      moved,
      patched (first, data): void {
        if (updatePresence(first, data)) {
          generation++
          if (latest) {
            const array = latest.array.slice(); const map = new Map(latest.map)
            latest.indices.forEach((id, slot) => {
              if (absent.has(id)) { map.delete(id); array.fill(NaN, slot * 2, slot * 2 + 2) }
            })
            latest = { ...latest, generation, array, map }
          }
        }
        moved()
      },
      beginReplacement (): void { replacing = true; generation++; latest = null },
      endReplacement (data): void {
        if (data) { absent.clear(); updatePresence(0, data) }
        replacing = false; moved()
      },
      destroy (): void { destroyed = true; latest = null; scope.destroy() },
    }
  } catch (cause) { scope.destroy(); throw cause }
}
