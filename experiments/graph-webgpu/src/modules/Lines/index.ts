import type { GraphConfigInterface } from '@/graph/config'
import type { GraphData } from '@/graph/modules/GraphData'

export const linkStride = 8

/** Pack each link as endpoint indices, width, stroke style and arrow flag, and RGBA. */
export function packLinks (data: GraphData, config: GraphConfigInterface): Float32Array {
  const pointCount = data.pointsNumber ?? 0
  const linkCount = data.linksNumber ?? 0
  const edges = new Float32Array(linkCount * linkStride)
  const highlightedLinks = config.highlightedLinkIndices && new Set(config.highlightedLinkIndices)
  for (let i = 0; i < linkCount; i++) {
    const at = i * linkStride
    const source = data.links?.[2 * i] ?? -1
    const target = data.links?.[2 * i + 1] ?? -1
    edges[at] = Number.isInteger(source) && source >= 0 ? source : pointCount
    edges[at + 1] = Number.isInteger(target) && target >= 0 ? target : pointCount
    edges[at + 2] = data.getResolvedLinkWidth(i)
    edges[at + 3] = (data.linkStyles?.[i] ?? 0) + (data.linkArrows?.[i] ? 4 : 0)
    for (let ch = 0; ch < 4; ch++) edges[at + 4 + ch] = data.getResolvedLinkColorChannel(i, ch)
    if (highlightedLinks && !highlightedLinks.has(i)) {
      edges[at + 7] = (edges[at + 7] ?? 0) * (config.linkBlending ? config.linkGreyoutOpacity : 0)
    }
  }
  return edges
}
