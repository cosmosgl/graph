import { Texture, type Buffer, type Device, type Framebuffer } from '@luma.gl/core'
import { createStorageRenderer } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { graphRgb } from '../../runtime/palette'
import type { TimestampWrites } from '../many-body/timing'

// The geometry pass writes the last visible owner at each sample. Background
// uses zero, links use one, and the pinned bit records the point's palette.
export const RESIDENT_OWNER_WGSL = `
const residentPinnedBit = 0x80000000u;
fn residentOwnerPoint(index: u32, pinned: f32) -> u32 {
  return (index + 2u) | select(0u, residentPinnedBit, pinned > 0.5);
}
`

const source = `
@group(0) @binding(0) var owners: texture_2d<u32>;
@group(0) @binding(1) var<uniform> display: vec4f;
${RESIDENT_OWNER_WGSL}

@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let triangle = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  return vec4f(triangle[index], 0., 1.);
}

@fragment fn fragmentMain(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let owner = textureLoad(owners, vec2i(pixel.xy), 0).x;
  if (owner == 0u) { return vec4f(${graphRgb.background}, 1.); }
  if (owner == 1u) { return vec4f(${graphRgb.link}, 1.); }
  if (f32((owner & ~residentPinnedBit) - 2u) == display.w) { return vec4f(${graphRgb.coral}, 1.); }
  let color = select(vec3f(${graphRgb.point}), vec3f(${graphRgb.pinned}), (owner & residentPinnedBit) != 0u);
  return vec4f(color, 1.);
}
`

// Palette-only presentation over the opaque resident graph. A change in the
// selected ID needs one fullscreen triangle and no point or link draws.
export function createResidentHighlight (device: Device, width: number, height: number, display: Buffer): {
  framebuffer: Framebuffer;
  present(timestamps?: TimestampWrites): void;
  destroy(): void;
} {
  const scope = resourceScope()
  try {
    const owners = scope.own(device.createTexture({
      width, height, format: 'r32uint', usage: Texture.RENDER | Texture.SAMPLE,
    }))
    const framebuffer = scope.own(device.createFramebuffer({ width, height, colorAttachments: [owners] }))
    const { kernel, vertexArray } = scope.own(createStorageRenderer(device, source, 'triangle-list', [
      { name: 'owners', location: 0, group: 0, type: 'texture', sampleType: 'uint', viewDimension: '2d' },
      { name: 'display', location: 1, group: 0, type: 'uniform' },
    ], {}, device.getDefaultCanvasContext()))
    return {
      framebuffer,
      present (timestamps): void {
        const timed = timestamps?.beginTimestampIndex !== undefined || timestamps?.endTimestampIndex !== undefined
        const pass = device.beginRenderPass({ clearDepth: false, ...(timed ? timestamps : undefined) })
        try { kernel.draw(pass, { vertexArray, vertexCount: 3, bindings: { owners, display } }) } finally { pass.end() }
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
