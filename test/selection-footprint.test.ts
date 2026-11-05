import { describe, expect, it } from 'vitest'
import { Graph, PointShape } from '@cosmos.gl/graph'

describe('selection footprints', () => {
  it.each([
    { pixelRatio: 1, scalePointsOnZoom: false },
    { pixelRatio: 2, scalePointsOnZoom: false },
    { pixelRatio: 1, scalePointsOnZoom: true },
    { pixelRatio: 2, scalePointsOnZoom: true },
  ])('matches footprints at pixel ratio $pixelRatio with scalePointsOnZoom=$scalePointsOnZoom', async ({ pixelRatio, scalePointsOnZoom }) => {
    const div = document.createElement('div')
    div.style.cssText = 'width:200px;height:200px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      pixelRatio,
      scalePointsOnZoom,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    graph.setPointPositions(new Float32Array([2048, 2048, 2048, 2048, 2048, 2048]))
    graph.setPointSizes(new Float32Array([20, 40, 0]))
    graph.render()
    try {
      await graph.ready
      expect(graph.maxPointSize).toBeGreaterThanOrEqual(40)
      for (const zoom of [1, 2]) {
        graph.setViewTransform({ k: zoom, x: 100 * (1 - zoom), y: 100 * (1 - zoom) }, [200, 200])
        graph.renderOneFrame()
        const [x, y] = graph.spaceToScreenPosition([2048, 2048])
        const radius = graph.spaceToScreenRadius(10)
        expect(radius).toBeCloseTo(scalePointsOnZoom ? 10 * zoom : 10)
        const query = (left: number, top: number, right: number, bottom: number, expected: number[]): void => {
          // The public API accepts either diagonal in either drag direction.
          expect(graph.findPointsInRect([[left, top], [right, bottom]])).toEqual(expected)
          expect(graph.findPointsInRect([[right, top], [left, bottom]])).toEqual(expected)
          expect(graph.findPointsInRect([[left, bottom], [right, top]])).toEqual(expected)
          expect(graph.findPointsInRect([[right, bottom], [left, top]])).toEqual(expected)
          // Include a repeated vertex to exercise zero-length edge handling.
          expect(graph.findPointsInPolygon([[left, top], [right, top], [right, top], [right, bottom], [left, bottom]])).toEqual(expected)
        }
        // Centre outside, footprint overlapping a straight edge.
        query(x + radius * 0.8, y - 2, x + radius * 0.9, y + 2, [0, 1])
        // Rectangle corner inside the circle's bounding box, outside the circle.
        query(x + radius * 0.8, y + radius * 0.8, x + radius * 0.9, y + radius * 0.9, [1])
        // Entire selection enclosed by the point.
        query(x - 1, y - 1, x + 1, y + 1, [0, 1])
        query(x + radius * 2.5, y - 2, x + radius * 3, y + 2, [])
        // Exercise the other side of the intersection test with all polygon
        // edges outside the circle and its centre inside the selection.
        query(x - radius * 3, y - radius * 3, x + radius * 3, y + radius * 3, [0, 1])
      }
      graph.setPointSizes(new Float32Array([64, 64, 0]))
      graph.setPointShapes(new Float32Array([PointShape.Circle, PointShape.Square, PointShape.Circle]))
      graph.render(undefined, 0)
      for (const zoom of [1, 2]) {
        graph.setViewTransform({ k: zoom, x: 100 * (1 - zoom), y: 100 * (1 - zoom) }, [200, 200])
        graph.renderOneFrame()
        const [x, y] = graph.spaceToScreenPosition([2048, 2048])
        const radius = graph.spaceToScreenRadius(32)
        const query = (vertices: [number, number][], expected: number[]): void => {
          for (const [a, b] of [[0, 2], [1, 3], [3, 1], [2, 0]] as const) {
            expect(graph.findPointsInRect([vertices[a]!, vertices[b]!])).toEqual(expected)
          }
          expect(graph.findPointsInPolygon(vertices)).toEqual(expected)
        }
        // Square corner overlaps, circle's curved edge stays outside.
        const corner: [number, number][] = [
          [x + radius * 0.75, y + radius * 0.75],
          [x + radius, y + radius * 0.75],
          [x + radius, y + radius],
          [x + radius * 0.75, y + radius],
        ]
        query(corner, [1])
        // The circle extends farther along the axes than the drawn square.
        query([
          [x + radius * 0.9, y - 1], [x + radius * 1.1, y - 1],
          [x + radius * 1.1, y + 1], [x + radius * 0.9, y + 1],
        ], [0])
        // A thin selection containing the centre and crossing the square.
        query([
          [x - radius * 2, y - 1], [x + radius * 2, y - 1],
          [x + radius * 2, y + 1], [x - radius * 2, y + 1],
        ], [0, 1])
        // The diagonal x+y = offset*radius cuts the square corner at
        // offset 1.5, but misses it at 1.7 (square half-width = 0.8*radius).
        // Both centres lie outside the triangles, and all vertices lie
        // outside the square. Both diagonal bounding boxes overlap it:
        // the near miss needs the segment's cross-product separating axis.
        for (const [offset, expected] of [[1.5, [1]], [1.7, []]] as const) {
          const triangle: [number, number][] = [
            [x - radius * 2, y + radius * (offset + 2)],
            [x + radius * (offset + 2), y - radius * 2],
            [x + radius * (offset + 2), y + radius * (offset + 2)],
          ]
          expect(graph.findPointsInPolygon(triangle)).toEqual(expected)
          expect(graph.findPointsInPolygon([...triangle].reverse())).toEqual(expected)
        }
        // Changing only shapes must invalidate the selection texture.
        graph.setPointShapes(new Float32Array([PointShape.Circle, PointShape.Circle, PointShape.Circle]))
        graph.render(undefined, 0)
        query(corner, [])
        graph.setPointShapes(new Float32Array([PointShape.Circle, PointShape.Square, PointShape.Circle]))
        graph.render(undefined, 0)
      }
      // Force the hardware-size cap, then query across the capped boundary.
      // Expectations come from the reported hardware limit, independently of
      // the CPU radius helper and the shader's size calculation.
      graph.setPointShapes(new Float32Array([PointShape.Circle, PointShape.Circle, PointShape.Circle]))
      graph.setPointSizes(new Float32Array([graph.maxPointSize * 2, graph.maxPointSize * 2, 0]))
      graph.render(undefined, 0)
      graph.setViewTransform({ k: 2, x: -100, y: -100 }, [200, 200])
      graph.renderOneFrame()
      const [x, y] = graph.spaceToScreenPosition([2048, 2048])
      const cappedRadius = graph.maxPointSize / 2
      expect(graph.spaceToScreenRadius(graph.maxPointSize)).toBeCloseTo(cappedRadius)
      for (const [distance, expected] of [[0.9, [0, 1]], [1.1, []]] as const) {
        const left = x + cappedRadius * distance
        const right = left + 1
        const top = y - 1
        const bottom = y + 1
        expect(graph.findPointsInRect([[left, top], [right, bottom]])).toEqual(expected)
        expect(graph.findPointsInPolygon([[left, top], [right, top], [right, bottom], [left, bottom]])).toEqual(expected)
      }
    } finally {
      graph.destroy()
      div.remove()
    }
  })
  it('uses a circular approximation for textured squares in both area queries', async () => {
    const div = document.createElement('div')
    div.style.cssText = 'width:200px;height:200px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      pixelRatio: 1,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    graph.setPointPositions(new Float32Array([2048, 2048, 2048, 2048]))
    graph.setPointSizes(new Float32Array([20, 20]))
    graph.setPointShapes(new Float32Array([PointShape.Square, PointShape.Square]))
    graph.setPointImageIndices(new Float32Array([0, -1]))
    graph.render()
    try {
      await graph.ready
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [200, 200])
      graph.renderOneFrame()
      const query = (expected: number[]): void => {
        // Distance 9 is beyond the square half-width 8 but within radius 10.
        expect(graph.findPointsInRect([[109, 99], [109.5, 101]])).toEqual(expected)
        expect(graph.findPointsInPolygon([[109, 99], [109.5, 99], [109.5, 101], [109, 101]])).toEqual(expected)
      }
      // No image set yet: even index 0 is invalid, so both use square geometry.
      query([])
      graph.setImageData([new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1)])
      graph.render(undefined, 0)
      query([0])
      // Removing only the image index must restore the square footprint.
      graph.setPointImageIndices(new Float32Array([-1, -1]))
      graph.render(undefined, 0)
      query([])
    } finally {
      graph.destroy()
      div.remove()
    }
  })
  it('treats collapsed polygons as point queries and preserves None-shape selection', async () => {
    const div = document.createElement('div')
    div.style.cssText = 'width:200px;height:200px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      pixelRatio: 1,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    graph.setPointPositions(new Float32Array([2048, 2048, 2048, 2048, 2048, 2048]))
    graph.setPointSizes(new Float32Array([20, 20, 0]))
    // No images: point 1 draws nothing but retains its resolved footprint.
    graph.setPointShapes(new Float32Array([PointShape.Circle, PointShape.None, PointShape.None]))
    graph.render()
    try {
      await graph.ready
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [200, 200])
      graph.renderOneFrame()
      const enclosing: [number, number][] = [[80, 80], [120, 80], [120, 120], [80, 120]]
      expect(graph.findPointsInPolygon(enclosing)).toEqual([0, 1])
      expect(graph.findPointsInRect([[80, 80], [120, 120]])).toEqual([0, 1])
      // Three identical vertices pass the API's vertex-count guard. The
      // zero-length edges select by distance, not by centre containment.
      for (const [x, expected] of [[109, [0, 1]], [111, []]] as const) {
        expect(graph.findPointsInPolygon([[x, 100], [x, 100], [x, 100]])).toEqual(expected)
        expect(graph.findPointsInRect([[x, 100], [x, 100]])).toEqual(expected)
      }
    } finally {
      graph.destroy()
      div.remove()
    }
  })
  it('scans complete polygon paths beyond the former 2048-edge limit', async () => {
    const div = document.createElement('div')
    div.style.cssText = 'width:200px;height:200px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      pixelRatio: 1,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    graph.setPointPositions(new Float32Array([2048, 2048]))
    graph.setPointSizes(new Float32Array([20]))
    graph.render()
    try {
      await graph.ready
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [200, 200])
      graph.renderOneFrame()
      const corners: [number, number][] = [[20, 20], [180, 20], [180, 180], [20, 180]]
      expect(graph.findPointsInPolygon(corners)).toEqual([0])
      for (const repeats of [2045, 2048]) {
        // All edges needed for containment follow a long repeated prefix.
        const path: [number, number][] = [
          ...Array.from({ length: repeats }, (): [number, number] => [20, 20]), ...corners.slice(1),
        ]
        expect(graph.findPointsInPolygon(path)).toEqual([0])
        expect(graph.findPointsInPolygon([...path].reverse())).toEqual([0])
      }
    } finally {
      graph.destroy()
      div.remove()
    }
  })
  it('projects off-centre points and intersects the interior of a diagonal lasso edge', async () => {
    const div = document.createElement('div')
    div.style.cssText = 'width:240px;height:180px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      pixelRatio: 1,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    // At the identity view, world (2048, 2048) maps to screen (120, 90).
    // These map to (65,65), (65,115), (75,75), and (35,35), independently
    // of spaceToScreenPosition. Points 0 and 1 are Y reflections.
    graph.setPointPositions(new Float32Array([1993, 2073, 1993, 2023, 2003, 2063, 1963, 2103]))
    graph.setPointSizes(new Float32Array([20, 20, 20, 20]))
    graph.render()
    try {
      await graph.ready
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [240, 180])
      graph.renderOneFrame()
      expect(graph.findPointsInRect([[56, 56], [58, 58]])).toEqual([0])

      // The diagonal from (100,20) to (20,100) has x+y=120.
      // Point 0 projects to its midpoint (60,60), t=0.5, at distance
      // sqrt(50) < radius 10. Its centre and both edge endpoints are
      // outside each other's footprint. Point 2 is too far away, point 3
      // is inside, and the reflected point 1 must remain unselected.
      const triangle: [number, number][] = [[20, 20], [100, 20], [20, 100]]
      expect(graph.findPointsInPolygon(triangle)).toEqual([0, 3])
      expect(graph.findPointsInPolygon([...triangle].reverse())).toEqual([0, 3])
    } finally {
      graph.destroy()
      div.remove()
    }
  })
  it('keeps footprint tangency on each polygon bound and rejects points beyond it', async () => {
    const div = document.createElement('div')
    div.style.cssText = 'width:200px;height:200px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      pixelRatio: 1,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    graph.setPointPositions(new Float32Array([2048, 2048, 2048, 2048]))
    graph.setPointSizes(new Float32Array([20, 20]))
    graph.setPointShapes(new Float32Array([PointShape.Circle, PointShape.Square]))
    graph.render()
    try {
      await graph.ready
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [200, 200])
      graph.renderOneFrame()
      for (const [distance, expected] of [[8, [0, 1]], [10, [0]], [10.25, []]] as const) {
        // Circle radius 10, rendered square half-width 8. The centre lies
        // outside every polygon here, so rejection must include the footprint.
        for (const [left, top, right, bottom] of [
          [100 + distance, 90, 120, 110],
          [80, 90, 100 - distance, 110],
          [90, 100 + distance, 110, 120],
          [90, 80, 110, 100 - distance],
        ] as [number, number, number, number][]) {
          expect(graph.findPointsInPolygon([[left, top], [right, top], [right, bottom], [left, bottom]])).toEqual(expected)
        }
      }
    } finally {
      graph.destroy()
      div.remove()
    }
  })
  it('preserves containment and footprint overlap around a concave lasso notch', async () => {
    const div = document.createElement('div')
    div.style.cssText = 'width:200px;height:200px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      pixelRatio: 1,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    // Identity view screen positions. Point 0 is inside the left arm and
    // relies on a distant edge to its right for the containment parity test.
    const centers: [number, number][] = [[35, 100], [100, 100], [59.5, 100], [59.5, 100], [57.5, 100], [150, 40]]
    graph.setPointPositions(new Float32Array(centers.flatMap(([x, y]) => [x + 1948, 2148 - y])))
    graph.setPointSizes(new Float32Array(centers.length).fill(20))
    graph.setPointShapes(new Float32Array([
      PointShape.Circle, PointShape.Circle, PointShape.Circle,
      PointShape.Square, PointShape.Square, PointShape.Circle,
    ]))
    graph.render()
    try {
      await graph.ready
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [200, 200])
      graph.renderOneFrame()
      const concave: [number, number][] = [
        [20, 20], [180, 20], [180, 50], [50, 50],
        [50, 150], [180, 150], [180, 180], [20, 180],
      ]
      // Circle 2 and square 4 overlap the notch wall at x=50. Point 1 is
      // outside, and square 3 falls short despite sharing circle 2's centre.
      expect(graph.findPointsInPolygon(concave)).toEqual([0, 2, 4, 5])
      expect(graph.findPointsInPolygon([...concave].reverse())).toEqual([0, 2, 4, 5])
    } finally {
      graph.destroy()
      div.remove()
    }
  })
})
