import { describe, expect, it } from 'vitest'
import { Graph, PointShape, type GraphConfig } from '@cosmos.gl/graph'

type Pair = [number, number]

// Run application code against the public import in each package's browser suite.
export function testPublicGeometry (context: 'webgl2' | 'webgpu'): void {
  async function withGraph<T> (
    positions: Float32Array,
    config: GraphConfig,
    check: (graph: Graph) => Promise<T>
  ): Promise<T> {
    const host = document.createElement('div')
    host.style.cssText = 'width:200px;height:200px'
    document.body.append(host)
    const graph = new Graph(host, {
      enableRenderLoop: false,
      enableSimulation: false,
      fitViewOnInit: false,
      rescalePositions: false,
      pixelRatio: 1,
      transitionDuration: 0,
      ...config,
    })
    try {
      graph.setPointPositions(positions, true)
      graph.render(1, 0)
      await graph.ready
      graph.pause()
      expect(host.querySelector('canvas')?.getContext(context)).toBeTruthy()
      return await check(graph)
    } finally {
      graph.destroy()
      host.remove()
    }
  }

  describe('public geometry', () => {
    it.each([1, 2])('resolves collapsed and tangent selections from the current footprints at %i×', async pixelRatio => {
      await withGraph(Float32Array.of(2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048), { pixelRatio }, async graph => {
        graph.setPointSizes(Float32Array.of(20, 20, 20, 0))
        graph.setPointShapes(Float32Array.of(PointShape.Circle, PointShape.Square, PointShape.None, PointShape.None))
        graph.render(undefined, 0)
        graph.setViewTransform({ k: 1, x: 0, y: 0 }, [200, 200])
        // The center is (100, 100). A size-20 square has an 8 px half-width.
        // A None shape still participates while its resolved size is positive.
        for (const [distance, expected] of [[8, [0, 1, 2]], [10, [0, 2]], [10.25, []]] as const) {
          for (const [dx, dy] of [[distance, 0], [-distance, 0], [0, distance], [0, -distance]] as Pair[]) {
            const point: Pair = [100 + dx, 100 + dy]
            expect(await graph.findPointsInRectAsync([point, point])).toEqual(expected)
            expect(await graph.findPointsInPolygonAsync([point, point, point])).toEqual(expected)
          }
        }
        graph.setConfigPartial({ pointSelectionMode: 'center' })
        expect(await graph.findPointsInPolygonAsync([[100, 100], [100, 100], [100, 100]])).toEqual([0, 1, 2])
        expect(await graph.findPointsInPolygonAsync([[101, 100], [101, 100], [101, 100]])).toEqual([])
      })
    })

    it.each([1, 2])('keeps a concave lasso and its closing edges in both windings at %i×', async pixelRatio => {
      const centers: Pair[] = [[35, 100], [100, 100], [59.5, 100], [59.5, 100], [57.5, 100], [150, 40]]
      const input = Float32Array.from(centers.flatMap(([x, y]) => [1948 + x, 2148 - y]))
      await withGraph(input, { pixelRatio }, async graph => {
        graph.setPointSizes(new Float32Array(centers.length).fill(20))
        graph.setPointShapes(Float32Array.of(PointShape.Circle, PointShape.Circle, PointShape.Circle,
          PointShape.Square, PointShape.Square, PointShape.Circle))
        graph.render(undefined, 0)
        graph.setViewTransform({ k: 1, x: 0, y: 0 }, [200, 200])
        // Only one of the two shapes centered 9.5 pixels from the notch wall touches it.
        const path: Pair[] = [[20, 20], [180, 20], [180, 50], [50, 50], [50, 150], [180, 150], [180, 180], [20, 180]]
        const longPath = [...Array<Pair>(32768).fill(path[0]!), ...path]
        for (const polygon of [path, [...path].reverse(), longPath, [...longPath].reverse()]) {
          expect(await graph.findPointsInPolygonAsync(polygon)).toEqual([0, 2, 4, 5])
        }
      })
    })

    it('fits two million world units and selects each corner at its projected position', async () => {
      const input = Float32Array.of(-1e6, -1e6, 1e6, 1e6, 0, 0, NaN, NaN)
      await withGraph(input, { pointSelectionMode: 'center' }, async graph => {
        graph.fitView(0, 0.1, false)
        await expect.poll(() => graph.getZoomLevel()).toBeCloseTo(0.00008, 12)
        for (const [id, [x, y]] of ([[20, 180], [180, 20], [100, 100]] as Pair[]).entries()) {
          const screen = graph.spaceToScreenPosition([input[2 * id]!, input[2 * id + 1]!])
          expect(screen[0]).toBeCloseTo(x, 5)
          expect(screen[1]).toBeCloseTo(y, 5)
          expect(await graph.findPointsInRectAsync([[x - 1, y - 1], [x + 1, y + 1]])).toEqual([id])
        }
      })
    })

    it('resolves grid collisions outside the initial space with an outlier 200,000 units away', async () => {
      const pairs = 2500
      const input = new Float32Array((2 * pairs + 1) * 2)
      for (let pair = 0; pair < pairs; pair++) {
        const x = 20000 + (pair % 50) * 40
        const y = -9000 + Math.floor(pair / 50) * 40
        input.set([x, y, x + 1, y], 4 * pair)
      }
      input.set([220000, -9000], 4 * pairs)
      await withGraph(input, {
        enableSimulation: true,
        simulationCollision: 1,
        simulationRepulsion: 0,
        simulationGravity: 0,
        simulationCenter: 0,
        simulationDecay: 1e12,
        pointDefaultSize: 8,
        randomSeed: 5,
      }, async graph => {
        graph.step()
        graph.step()
        const xy = await graph.getPointPositionsAsync()
        let minDistance = Infinity
        for (let i = 0; i < 4 * pairs; i += 4) {
          minDistance = Math.min(minDistance, Math.hypot(xy[i]! - xy[i + 2]!, xy[i + 1]! - xy[i + 3]!))
        }
        expect(minDistance).toBeGreaterThan(7.9)
        expect(Array.from(xy.slice(-2))).toEqual([220000, -9000])
      })
    })

    it('translates the many-body grid with the data when a distant point expands its bounds', async () => {
      const count = 5000
      // Nonuniform rows keep near-field repulsion observable even after the outlier
      // makes the coarsest cells much wider than the local spacing.
      const local = new Float32Array((count + 1) * 2)
      for (let i = 0; i < count; i++) {
        local[2 * i] = (i % 100) * 2 + (i % 7) * 0.125
        local[2 * i + 1] = Math.floor(i / 100) * 3 + (i % 5) * 0.125
      }
      local.set([200000, 0], 2 * count)
      const layoutAt = async (dx: number, dy: number): Promise<Float32Array> => {
        const input = local.map((value, i) => value + (i % 2 === 0 ? dx : dy))
        const xy = await withGraph(input, {
          enableSimulation: true,
          simulationGravity: 0,
          simulationCenter: 0,
          simulationRepulsion: 1,
          simulationDecay: 1e12,
          randomSeed: 5,
        }, async graph => {
          graph.step()
          return graph.getPointPositionsAsync()
        })
        expect(xy).toHaveLength(input.length)
        expect(xy.every(Number.isFinite)).toBe(true)
        return xy.map((value, i) => value - input[i]!)
      }
      const original = await layoutAt(0, 0)
      const translated = await layoutAt(-9000, 20000)
      let totalMotion = 0
      let error = 0
      for (let i = 0; i < 2 * count; i++) {
        totalMotion += original[i]! ** 2
        error += (original[i]! - translated[i]!) ** 2
      }
      expect(Math.sqrt(totalMotion / count)).toBeGreaterThan(0.1)
      // One float32 step near y = 20,000 is about 0.002 world units.
      expect(Math.sqrt(error / count)).toBeLessThan(0.004)
    })

    it('moves clusters to negative targets and keeps a missing or nonfinite target at its centroid', async () => {
      const ids = [0, 0, 1, 1, 2, 2, 3, 3]
      const input = Float32Array.from(ids.flatMap((_, i) => i % 2 ? [2100, 2020] : [1996, 2076]))
      await withGraph(input, {
        enableSimulation: true,
        simulationGravity: 0,
        simulationCenter: 0,
        simulationRepulsion: 0,
        simulationCluster: 1,
        simulationDecay: 1e12,
        randomSeed: 7,
      }, async graph => {
        graph.setPointClusters(ids)
        graph.setClusterPositions([-3000, 2048, 2048, -5000, undefined, undefined, NaN, 100])
        graph.render(1, 0)
        for (let i = 0; i < 100; i++) graph.step()
        const xy = await graph.getPointPositionsAsync()
        for (const [group, [x, y]] of ([[-3000, 2048], [2048, -5000], [2048, 2048], [2048, 2048]] as Pair[]).entries()) {
          const i = 4 * group
          expect((xy[i]! + xy[i + 2]!) / 2).toBeCloseTo(x, 0)
          expect((xy[i + 1]! + xy[i + 3]!) / 2).toBeCloseTo(y, 0)
        }
      })
    })
  })
}
