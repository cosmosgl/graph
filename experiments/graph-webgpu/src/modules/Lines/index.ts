import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import type { GraphData } from '@/graph/modules/GraphData'
import { updateStyleBuffer } from '../Shared/style-buffer'
import { captureSizes, type SizeValues } from '../../size-transition'
import records from '../../style-records.wgsl?raw'
import updateWidths from './update-widths.wgsl?raw'

const linkStride = 8

type LinkRgb = [number, number, number]

/** Pack each link as endpoint indices, width, stroke style and arrow flag, and RGBA. */
function packLinks (data: GraphData, config: GraphConfigInterface): {
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

/** Link records are shared by canvas, host and picking passes. */
export class Lines {
  public buffer?: Buffer
  public count = 0
  public hasOnlySolidLinks = false
  public uniformRgb?: LinkRgb
  public widths: SizeValues = 0
  private widthKernel?: Kernel

  public constructor (private readonly device: Device, private readonly trackSizes: boolean) {}

  public update (data: GraphData, config: GraphConfigInterface, retainPrevious: boolean): void {
    const { edges, hasOnlySolidLinks, uniformRgb } = packLinks(data, config)
    const count = edges.length / linkStride
    const widths = this.trackSizes ? captureSizes(count, i => edges[i * linkStride + 2]!) : 0
    const old = retainPrevious ? undefined : this.buffer
    const next = updateStyleBuffer(this.device, old, edges, 'cosmos-link-style', linkStride * 4)
    if (old !== next) old?.destroy()
    this.buffer = next
    this.count = count
    this.widths = widths
    this.hasOnlySolidLinks = hasOnlySolidLinks
    this.uniformRgb = uniformRgb
  }

  /** Patch only the width lane. An animation may need a GPU copy of the old target before this write. */
  public updateWidths (data: GraphData, snapshot: boolean): Buffer | undefined {
    if (!this.count && !snapshot) return undefined
    const target = this.buffer!
    const device = this.device
    let previous: Buffer | undefined
    let widths: Buffer | undefined
    const resolved = captureSizes(this.count, i => data.getResolvedLinkWidth(i))
    const encoder = device.createCommandEncoder()
    try {
      if (snapshot) {
        const size = Math.max(1, this.count) * linkStride * Float32Array.BYTES_PER_ELEMENT
        previous = device.createBuffer({ byteLength: size, usage: Buffer.STORAGE | Buffer.COPY_DST })
        encoder.copyBufferToBuffer({ sourceBuffer: target, destinationBuffer: previous, size })
      }
      if (this.count > 0) {
        this.widthKernel ??= new Kernel(device, {
          id: 'cosmos-update-link-widths',
          source: records + updateWidths,
          shaderLayout: {
            bindings: [
              { name: 'links', type: 'storage', group: 0, location: 0 },
              { name: 'widths', type: 'read-only-storage', group: 0, location: 1 },
            ],
          },
        })
        const values = typeof resolved === 'number' ? new Float32Array(this.count).fill(resolved) : resolved
        widths = device.createBuffer({ id: 'cosmos-link-widths', data: values, usage: Buffer.STORAGE })
        const groups = Math.ceil(this.count / 64)
        const x = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension)
        const pass = encoder.beginComputePass({})
        try {
          this.widthKernel.dispatch(pass, { x, y: Math.ceil(groups / x), bindings: { links: target, widths } })
        } finally { pass.end() }
      }
      device.submit(encoder.finish())
      if (this.trackSizes) this.widths = resolved
      return previous
    } catch (e) {
      previous?.destroy()
      throw e
    } finally {
      widths?.destroy()
      encoder.destroy()
    }
  }

  public destroy (): void {
    this.widthKernel?.destroy()
    this.buffer?.destroy()
    this.widths = 0
  }
}
