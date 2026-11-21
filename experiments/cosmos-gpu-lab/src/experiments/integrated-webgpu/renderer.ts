import { Buffer, type Framebuffer, type ComputePassProps, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/graph'
import { ALPHA_BLEND, bindingLayout, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { target, pixels } from '../../gpu/rgba-readback'
import { graphRgba } from '../../runtime/palette'
import type { PositionSource } from '../many-body/backend'
import type { GraphInput } from '../weighted-links/data'
import source from './render.wgsl?raw'
import linkSmoothing from './link-smoothing.wgsl?raw'
export type Camera = { x: number; y: number; zoom: number }
export type PaintLayers = { links?: boolean; points?: boolean }
export type LinkDistanceOpacity = { range: readonly [number, number]; minimum: number }
type Rgba = [number, number, number, number]
export type ViewerPaint = {
  smoothLinks?: boolean; linkDistanceOpacity?: LinkDistanceOpacity;
  background?: Rgba; defaultPoint?: { color: Rgba; size: number };
}
type PaintOptions = ViewerPaint & { linkIndex?: number }
type PickedObject = { kind: 'point' | 'link'; id: number }
const entries = {
  point: ['pointVertex', 'pointColor'],
  link: ['linkVertex', 'linkColor'],
  id: ['pointVertex', 'pointId'],
  linkId: ['linkVertex', 'linkId'],
  smoothLink: ['smoothLinkVertex', 'smoothLinkColor'],
  smoothLinkId: ['smoothLinkVertex', 'smoothLinkId'],
}
export function createRenderer (position: () => PositionSource, graph: GraphInput, canvas: HTMLCanvasElement, paint: ViewerPaint = {}): {
  camera: Camera; styles: Float32Array; readonly styleSource: Buffer; selected: number; selectedLink: number; ratio: number;
  linkStyle: { color: number[]; width: number }; setLinkStyle(color: number[], width: number): void;
  draw(timestamps?: ComputePassProps): void; pick(x: number, y: number): Promise<number | null>;
  pickObject(x: number, y: number): Promise<PickedObject | null>;
  snapshot(options?: PaintOptions): Promise<{ color: Uint8Array; ids: Uint8Array; width: number; height: number }>;
  snapshotColor(layers: PaintLayers & PaintOptions): Promise<Uint8Array>;
  replace(graph: GraphInput): void; setLinks(links: Float32Array): void; setStyle(index: number, color: number[], size: number): void;
  destroy(): void;
} {
  const { device } = position(); const scope = resourceScope()
  let styleBuffer!: Buffer; let linkBuffer!: Buffer; let edges = 0
  const layout = {
    attributes: [],
    bindings: bindingLayout([
      ['positions', 'read-only-storage'], ['styles', 'read-only-storage'], ['links', 'read-only-storage'], ['params', 'uniform'],
    ]),
  }
  try {
    const params = scope.own(upload(device, new Float32Array(24), Buffer.UNIFORM))
    const vertexArray = scope.own(device.createVertexArray({ shaderLayout: layout, bufferLayout: [] }))
    const pickTarget = scope.own(target(device, 1, 1))
    const kernels = new Map<string, RenderKernel>()
    const kernel = (format: TextureFormatColor, mode: keyof typeof entries, depth = false): RenderKernel => {
      const key = `${format}:${mode}:${depth}`; let value = kernels.get(key)
      if (!value) {
        const code = mode === 'smoothLink' || mode === 'smoothLinkId' ? `${source}\n${linkSmoothing}` : source
        value = scope.own(new RenderKernel(device, {
          vertexSource: code,
          fragmentSource: code,
          vertexEntryPoint: entries[mode][0],
          fragmentEntryPoint: entries[mode][1],
          topology: 'triangle-strip',
          shaderLayout: layout,
          colorAttachmentFormats: [format],
          depthStencilAttachmentFormat: depth ? 'depth24plus' : undefined,
          parameters: {
            ...(mode === 'id' || mode === 'linkId' || mode === 'smoothLinkId' ? { blend: false } : ALPHA_BLEND),
            cullMode: 'none',
            ...(depth ? { depthWriteEnabled: false, depthCompare: 'always' as const } : {}),
          },
        })); kernels.set(key, value)
      }
      return value
    }
    const render = (
      framebuffer: Framebuffer, ids: false | 'point' | 'object', origin = [0, 0], transparent = false, timestamps?: ComputePassProps,
      layers?: PaintLayers & PaintOptions
    ): void => {
      const { camera, ratio, selected, selectedLink } = api
      const visibility = layers?.linkDistanceOpacity ?? paint.linkDistanceOpacity
      const linkIndex = layers?.linkIndex
      if (linkIndex !== undefined && (!Number.isInteger(linkIndex) || linkIndex < 0 || linkIndex >= edges)) {
        throw new Error('Invalid diagnostic link index')
      }
      params.write(new Float32Array([camera.x, camera.y, camera.zoom * ratio, camera.zoom,
        canvas.width, canvas.height, ratio, 0, ...origin, framebuffer.width, framebuffer.height, selected, api.linkStyle.width, selectedLink, 0,
        ...api.linkStyle.color, ...(visibility ? [...visibility.range, visibility.minimum, 1] : [0, 0, 0, 0])]))
      const pass = device.beginRenderPass({
        ...timestamps, framebuffer, clearColor: ids || transparent ? [0, 0, 0, 0] : paint.background ?? graphRgba.background, clearDepth: false,
      })
      const bindings = { positions: position().buffer, styles: styleBuffer, links: linkBuffer, params }
      const format = framebuffer.colorAttachments[0].texture.format as TextureFormatColor
      try {
        if (ids !== 'point' && edges && layers?.links !== false) {
          const smooth = layers?.smoothLinks ?? paint.smoothLinks
          const mode = ids === 'object' ? (smooth ? 'smoothLinkId' : 'linkId') : (smooth ? 'smoothLink' : 'link')
          kernel(format, mode, !!framebuffer.depthStencilAttachment).draw(pass, {
            vertexArray, vertexCount: 4, firstInstance: linkIndex ?? 0, instanceCount: linkIndex === undefined ? edges : 1, bindings,
          })
        }
        if (position().count && layers?.points !== false) {
          kernel(format, ids ? 'id' : 'point', !!framebuffer.depthStencilAttachment).draw(pass, {
            vertexArray, vertexCount: 4, instanceCount: position().count, bindings,
          })
        }
      } finally { pass.end() }
      device.submit()
    }
    const pickAt = async (x: number, y: number, kind: 'point' | 'object'): Promise<PickedObject | null> => {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null
      render(pickTarget.framebuffer, kind, [Math.floor(x), Math.floor(y)])
      const bytes = await pixels(device, pickTarget.texture, pickTarget.framebuffer)
      const id = bytes[0] + bytes[1] * 256 + bytes[2] * 65536
      return id ? { id: id - 1, kind: bytes[3] === 255 ? 'point' : 'link' } : null
    }
    const api = {
      camera: { x: 0, y: 0, zoom: 2 },
      linkStyle: { color: [127 / 255, 137 / 255, 152 / 255, 0.45], width: 1.25 },
      setLinkStyle (color: number[], width: number): void {
        if (color.length !== 4 || !color.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
          !Number.isFinite(width) || width < 0 || width > 64) throw new Error('Unsupported link style: RGBA 0..1, width 0..64 CSS px')
        api.linkStyle = { color: [...color], width }
      },
      styles: new Float32Array(),
      get styleSource (): Buffer { return styleBuffer },
      selected: -1,
      selectedLink: -1,
      ratio: 1,
      replace (next: GraphInput): void {
        const data = new Float32Array(next.points.length * 2)
        const defaults = [...(paint.defaultPoint?.color ?? graphRgba.point), paint.defaultPoint?.size ?? 6, 0, 0, 0]
        for (let i = 0; i < next.points.length / 4; i++) data.set(defaults, i * 8)
        const freshStyles = upload(device, data)
        let freshLinks: Buffer
        try { freshLinks = upload(device, new Uint32Array(next.links)) } catch (error) { freshStyles.destroy(); throw error }
        styleBuffer?.destroy(); linkBuffer?.destroy(); styleBuffer = freshStyles; linkBuffer = freshLinks
        api.styles = data; api.selected = -1; api.selectedLink = -1; edges = next.links.length / 2
      },
      setLinks (links: Float32Array): void {
        const values = new Uint32Array(links)
        if (linkBuffer && values.byteLength <= linkBuffer.byteLength) {
          if (values.length) linkBuffer.write(values)
        } else {
          const fresh = upload(device, values)
          linkBuffer?.destroy(); linkBuffer = fresh
        }
        edges = values.length / 2
      },
      setStyle (index: number, color: number[], size: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= position().count || color.length !== 4 ||
          !color.every(v => Number.isFinite(v) && v >= 0 && v <= 1) || (color[3] > 0 && color[3] < 0.02) ||
          !Number.isFinite(size) || size < 0 || size > 64) throw new Error('Unsupported point style: RGBA 0..1, alpha 0 or >= 0.02, size 0..64 CSS px')
        const data = new Float32Array([...color, size, 0, 0, 0]); api.styles.set(data, index * 8); styleBuffer.write(data, index * 32)
      },
      draw (timestamps?: ComputePassProps): void { render(device.canvasContext!.getCurrentFramebuffer(), false, [0, 0], false, timestamps) },
      async pick (x: number, y: number): Promise<number | null> {
        return (await pickAt(x, y, 'point'))?.id ?? null
      },
      pickObject: async (x: number, y: number): Promise<PickedObject | null> => await pickAt(x, y, 'object'),
      async snapshot (options?: PaintOptions): Promise<{ color: Uint8Array; ids: Uint8Array; width: number; height: number }> {
        const color = target(device, canvas.width, canvas.height); const ids = target(device, canvas.width, canvas.height)
        try {
          render(color.framebuffer, false, [0, 0], true, undefined, options); render(ids.framebuffer, 'point')
          return {
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
            width: canvas.width,
            height: canvas.height,
          }
        } finally { color.destroy(); ids.destroy() }
      },
      async snapshotColor (layers: PaintLayers & PaintOptions): Promise<Uint8Array> {
        const color = target(device, canvas.width, canvas.height)
        try {
          render(color.framebuffer, false, [0, 0], true, undefined, layers)
          return await pixels(device, color.texture, color.framebuffer)
        } finally { color.destroy() }
      },
      destroy (): void { styleBuffer?.destroy(); linkBuffer?.destroy(); scope.destroy() },
    }
    api.replace(graph)
    // Compile both display and picking before the first measured interaction.
    const frame = device.canvasContext!.getCurrentFramebuffer()
    for (const mode of [paint.smoothLinks ? 'smoothLink' : 'link', 'point'] as const) {
      kernel(frame.colorAttachments[0].texture.format as TextureFormatColor, mode, !!frame.depthStencilAttachment)
    }
    kernel('rgba8unorm', 'id')
    return api
  } catch (error) { styleBuffer?.destroy(); linkBuffer?.destroy(); scope.destroy(); throw error }
}
