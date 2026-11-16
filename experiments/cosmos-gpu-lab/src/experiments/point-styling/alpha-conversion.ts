import { Model } from '@luma.gl/engine'
import { RenderKernel } from '@luma.gl/graph'
import { ALPHA_BLEND, bindingLayout, createDevice, describeDevice, upload } from '../../gpu/luma'
import { floatPixels, pixels, target } from '../../gpu/rgba-readback'
import { resourceScope } from '../../gpu/resource-scope'
import { sourceAlphaByte, SOURCE_ALPHA_GLSL, SOURCE_ALPHA_WGSL } from './source-alpha'

export function alphaBoundarySamples (): Float32Array {
  const value = new Float32Array(1); const bits = new Uint32Array(value.buffer)
  return Float32Array.from([0, 1, ...Array.from({ length: 255 }, (_, byte) => {
    value[0] = (byte + 0.5) / 255; const center = bits[0]
    return [-1, 0, 1].map(offset => { bits[0] = center + offset; return value[0] })
  }).flat()])
}

export type AlphaConversion = {
  backend: string;
  samples: Float32Array;
  shader: Float32Array;
  unblended: Uint8Array;
  blended: Uint8Array;
}

// Isolate attachment conversion from shape coverage, interpolation, images and
// the production shaders. Every pixel receives one source alpha over clear zero.
// All GPU objects, draws and readbacks use public luma APIs.
export async function inspectAlphaConversion (type: 'webgl' | 'webgpu', samples = alphaBoundarySamples()): Promise<AlphaConversion> {
  const errors: string[] = []
  const device = await createDevice(type, type === 'webgl' ? document.createElement('canvas') : undefined, false, error => {
    errors.push(error.message); return true
  })
  const scope = resourceScope()
  try {
    const input = scope.own(type === 'webgl' ? device.createBuffer({ data: samples }) : upload(device, samples))
    const shaderLayout = { attributes: [], bindings: bindingLayout([['samples', 'read-only-storage']]) }
    const vertexArray = type === 'webgpu' ? scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] })) : undefined
    const outputs: Array<Float32Array | Uint8Array> = []
    for (const mode of ['float', 'unblended', 'blended'] as const) {
      const format = mode === 'float' ? 'rgba32float' : 'rgba8unorm'
      const output = scope.own(target(device, samples.length, 1, format))
      const parameters = {
        ...(mode === 'blended' ? ALPHA_BLEND : { blend: false }),
        ...(type === 'webgl' ? { depthWriteEnabled: false, depthCompare: 'always' as const } : {}),
      }
      const expression = mode === 'float' ? 'a, a * 255.0, quantizeSourceAlpha(a) * 255.0, a' : 'a, a, a, a'
      const model = type === 'webgl'
        ? scope.own(new Model(device, {
          id: `alpha-conversion-${mode}`,
          vs: `#version 300 es
precision highp float;
in float sampleAlpha; flat out float alpha;
void main() {
  alpha = sampleAlpha;
  gl_Position = vec4((float(gl_VertexID) + 0.5) / ${samples.length}.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`,
          fs: `#version 300 es
precision highp float;
precision highp int;
flat in float alpha; out vec4 color;
${SOURCE_ALPHA_GLSL}
void main() { float a = alpha; color = vec4(${expression}); }`,
          topology: 'point-list',
          vertexCount: samples.length,
          attributes: { sampleAlpha: input },
          bufferLayout: [{ name: 'sampleAlpha', format: 'float32' }],
          parameters,
        }))
        : undefined
      const wgsl = `@group(0) @binding(0) var<storage, read> samples: array<f32>;
${SOURCE_ALPHA_WGSL}
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let corners = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(corners[i], 0, 1);
}
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let a = samples[u32(position.x)]; return vec4f(${expression});
}`
      const kernel = type === 'webgpu'
        ? scope.own(new RenderKernel(device, {
          vertexSource: wgsl,
          fragmentSource: wgsl,
          vertexEntryPoint: 'vertexMain',
          fragmentEntryPoint: 'fragmentMain',
          topology: 'triangle-list',
          shaderLayout,
          colorAttachmentFormats: [format],
          parameters,
        }))
        : undefined
      const pass = device.beginRenderPass({ framebuffer: output.framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
      try {
        if (model) model.draw(pass)
        else kernel!.draw(pass, { vertexArray: vertexArray!, vertexCount: 3, bindings: { samples: input } })
      } finally { pass.end() }
      device.submit()
      outputs.push(mode === 'float'
        ? await floatPixels(device, output.texture, output.framebuffer)
        : await pixels(device, output.texture, output.framebuffer))
    }
    if (errors.length) throw new Error(errors.join('\n'))
    return {
      backend: describeDevice(device),
      samples,
      shader: outputs[0] as Float32Array,
      unblended: outputs[1] as Uint8Array,
      blended: outputs[2] as Uint8Array,
    }
  } finally { try { scope.destroy() } finally { device.destroy() } }
}

export function conversionRows (result: AlphaConversion): Array<{
  sample: number; alpha: number; bits: string; scaled: number; shaderAlpha: number; policyByte: number;
  shaderByte: number; unblended: number; blended: number;
}> {
  const bits = new Uint32Array(result.samples.buffer, result.samples.byteOffset, result.samples.length)
  return Array.from(result.samples, (alpha, sample) => ({
    sample,
    alpha,
    bits: `0x${bits[sample].toString(16).padStart(8, '0')}`,
    scaled: result.shader[sample * 4 + 1],
    shaderAlpha: result.shader[sample * 4],
    policyByte: sourceAlphaByte(alpha),
    shaderByte: result.shader[sample * 4 + 2],
    unblended: result.unblended[sample * 4 + 3],
    blended: result.blended[sample * 4 + 3],
  }))
}
