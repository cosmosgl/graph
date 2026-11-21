import { resourceScope } from '../../gpu/resource-scope'
import { createRenderer } from '../integrated-webgpu/renderer'
import { createResidentGraph } from '../many-body-grid/resident-graph'
import type { ComparisonInput } from './comparison-input'

export type ComparisonCandidate = {
  graph: Awaited<ReturnType<typeof createResidentGraph>>;
  drawing: ReturnType<typeof createRenderer>;
  destroy(): void;
}

export async function createComparisonCandidate (
  canvas: HTMLCanvasElement, { scene, size }: ComparisonInput, pixelRatio: number
): Promise<ComparisonCandidate> {
  const scope = resourceScope()
  try {
    const graph = scope.own(await createResidentGraph(canvas, scene.input, scene.graph, 'four-corners', {
      pixelRatio, externalDraw: true, productionForceDefaults: true,
    }))
    const drawing = scope.own(createRenderer(() => graph.positionSource(), scene.graph, canvas, {
      smoothLinks: true,
      linkDistanceOpacity: { range: [50, 150], minimum: 0.25 },
      background: [34 / 255, 34 / 255, 34 / 255, 1],
      defaultPoint: { color: [179 / 255, 179 / 255, 179 / 255, 1], size },
    }))
    drawing.ratio = pixelRatio
    drawing.setLinkStyle([0.4, 0.4, 0.4, 1], 1)
    return { graph, drawing, destroy: scope.destroy }
  } catch (error) { scope.destroy(); throw error }
}
