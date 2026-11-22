import { LabelRenderer } from '@cosmograph/vis-labels'
import type { Graph } from '@cosmos.gl/graph'
import type { SceneData } from './types'

export function createClusterLabels (
  container: HTMLDivElement,
  graph: Graph,
  communities: NonNullable<SceneData['clusterLabels']>
): { draw: (nonBlocking?: boolean) => void; destroy: () => void } {
  const overlay = document.createElement('div')
  overlay.className = 'example-cluster-labels'
  container.appendChild(overlay)
  const renderer = new LabelRenderer(overlay, {
    fontSize: 12,
    pointerEvents: 'none',
    padding: { left: 5, right: 5, top: 2, bottom: 2 },
  })

  return {
    draw: (nonBlocking = true): void => {
      const centers = graph.getClusterPositions({ nonBlocking })
      const labels = communities.flatMap(({ text, color, weight }, index) => {
        const x = centers[index * 2]
        const y = centers[index * 2 + 1]
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y) || !weight) return []
        const [screenX, screenY] = graph.spaceToScreenPosition([x, y])
        return [{ id: String(index), text, color, weight, x: screenX, y: screenY, opacity: 1 }]
      })
      renderer.setLabels(labels)
      renderer.draw()
    },
    destroy: (): void => {
      renderer.destroy()
      overlay.remove()
    },
  }
}
