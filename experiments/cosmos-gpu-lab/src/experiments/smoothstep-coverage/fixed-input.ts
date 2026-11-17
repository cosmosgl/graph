import { Buffer, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { RenderKernel } from '@luma.gl/graph'
import { bindingLayout, createDevice, upload } from '../../gpu/luma'
import { floatPixels, target } from '../../gpu/rgba-readback'
import { resourceScope } from '../../gpu/resource-scope'
import type { CoverageFormula } from '../straight-links/data'

// Adjacent float32 values on either side of the recorded half-coverage tie.
export const FIXED_INPUTS = [0.3749999701976776, 0.375, 0.3750000298023224]
export const SMOOTHING = 0.25
export type FixedRow = { backend: 'WebGL' | 'WebGPU'; formula: CoverageFormula; input: number;
  actualInput: number; smoothing: number; coverage: number; drawn: boolean; }

const glVertex = `#version 300 es
void main() {
  vec2 p = gl_VertexID == 0 ? vec2(-1.0, -1.0) : gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`
const glFragment = (formula: CoverageFormula): string => `#version 300 es
precision highp float;
layout(std140) uniform probeUniforms { vec4 values; };
out vec4 color;
void main() {
  float coverage = ${formula === 'descending'
    ? 'smoothstep(0.5, 0.5 - values.y, abs(values.x))'
    : '1.0 - smoothstep(0.5 - values.y, 0.5, abs(values.x))'};
  color = vec4(values.x, values.y, coverage, step(0.5, coverage));
}`
const gpuShader = (formula: CoverageFormula): string => `
@group(0) @binding(0) var<uniform> probeUniforms: vec4f;
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[i], 0, 1);
}
@fragment fn fragmentMain() -> @location(0) vec4f {
  let coverage = ${formula === 'descending'
    ? 'smoothstep(0.5, 0.5 - probeUniforms.y, abs(probeUniforms.x))'
    : '1.0 - smoothstep(0.5 - probeUniforms.y, 0.5, abs(probeUniforms.x))'};
  return vec4f(probeUniforms.x, probeUniforms.y, coverage, select(0.0, 1.0, coverage >= 0.5));
}`

export async function fixedInputProbe (backend: 'webgl' | 'webgpu'): Promise<{ info: string; rows: FixedRow[] }> {
  const device = await createDevice(backend, document.createElement('canvas'), false)
  const scope = resourceScope()
  try {
    const output = scope.own(target(device, 1, 1, 'rgba32float'))
    const rows: FixedRow[] = []
    const info = `${device.info.type}: ${String(device.info.vendor)} / ${String(device.info.renderer)}`
    const uniforms = backend === 'webgl'
      ? scope.own(new UniformStore(device, {
        probeUniforms: { uniformTypes: { values: 'vec4<f32>' } },
      }))
      : undefined
    const buffer = backend === 'webgpu' ? scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM)) : undefined
    const shaderLayout = { attributes: [], bindings: bindingLayout([['probeUniforms', 'uniform']]) }
    const vertexArray = backend === 'webgpu' ? scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] })) : undefined
    for (const formula of ['descending', 'ascending'] as const) {
      const model = backend === 'webgl'
        ? scope.own(new Model(device, {
          vs: glVertex,
          fs: glFragment(formula),
          topology: 'triangle-list',
          vertexCount: 3,
          bindings: { probeUniforms: uniforms!.getManagedUniformBuffer('probeUniforms') },
          parameters: { blend: false, cullMode: 'none', depthWriteEnabled: false, depthCompare: 'always' },
        }))
        : undefined
      const code = gpuShader(formula)
      const kernel = backend === 'webgpu'
        ? scope.own(new RenderKernel(device, {
          vertexSource: code,
          fragmentSource: code,
          vertexEntryPoint: 'vertexMain',
          fragmentEntryPoint: 'fragmentMain',
          topology: 'triangle-list',
          shaderLayout,
          colorAttachmentFormats: ['rgba32float'],
          parameters: { blend: false, cullMode: 'none' },
        }))
        : undefined
      for (const input of FIXED_INPUTS) {
        if (uniforms) uniforms.setUniforms({ probeUniforms: { values: [input, SMOOTHING, 0, 0] } })
        if (buffer) buffer.write(new Float32Array([input, SMOOTHING, 0, 0]))
        const pass = device.beginRenderPass({ framebuffer: output.framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
        try {
          if (model) model.draw(pass)
          if (kernel) kernel.draw(pass, { vertexArray: vertexArray!, vertexCount: 3, bindings: { probeUniforms: buffer! } })
        } finally { pass.end() }
        device.submit()
        const values = await floatPixels(device, output.texture, output.framebuffer)
        rows.push({
          backend: backend === 'webgl' ? 'WebGL' : 'WebGPU',
          formula,
          input,
          actualInput: values[0],
          smoothing: values[1],
          coverage: values[2],
          drawn: values[3] > 0.5,
        })
      }
    }
    return { info, rows }
  } finally { try { scope.destroy() } finally { device.destroy() } }
}
