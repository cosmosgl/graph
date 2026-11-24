import type { GraphConfigInterface } from '@/graph/config'
import type { GraphData } from '@/graph/modules/GraphData'

export const linkStride = 8

export type LinkRgb = [number, number, number]

/** Pack each link as endpoint indices, width, stroke style and arrow flag, and RGBA. */
export function packLinks (data: GraphData, config: GraphConfigInterface): {
  edges: Float32Array;
  hasOnlySolidLinks: boolean;
  uniformRgb?: LinkRgb;
} {
  const pointCount = data.pointsNumber ?? 0
  const linkCount = data.linksNumber ?? 0
  const edges = new Float32Array(linkCount * linkStride)
  const highlightedLinks = config.highlightedLinkIndices && new Set(config.highlightedLinkIndices)
  let hasOnlySolidLinks = true
  let sameRgb = linkCount > 0
  for (let i = 0; i < linkCount; i++) {
    const at = i * linkStride
    const source = data.links?.[2 * i] ?? -1
    const target = data.links?.[2 * i + 1] ?? -1
    edges[at] = Number.isInteger(source) && source >= 0 ? source : pointCount
    edges[at + 1] = Number.isInteger(target) && target >= 0 ? target : pointCount
    edges[at + 2] = data.getResolvedLinkWidth(i)
    const style = (data.linkStyles?.[i] ?? 0) + (data.linkArrows?.[i] ? 4 : 0)
    edges[at + 3] = style
    if (style !== 0) hasOnlySolidLinks = false
    for (let ch = 0; ch < 4; ch++) edges[at + 4 + ch] = data.getResolvedLinkColorChannel(i, ch)
    if (highlightedLinks && !highlightedLinks.has(i)) {
      edges[at + 7] = (edges[at + 7] ?? 0) * (config.linkBlending ? config.linkGreyoutOpacity : 0)
    }
    sameRgb &&= hasOnlySolidLinks && edges[at + 4] === edges[4] && edges[at + 5] === edges[5] && edges[at + 6] === edges[6]
  }
  return { edges, hasOnlySolidLinks, uniformRgb: sameRgb ? [edges[4]!, edges[5]!, edges[6]!] : undefined }
}
