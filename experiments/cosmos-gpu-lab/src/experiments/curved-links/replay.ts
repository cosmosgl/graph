import { Model, RenderKernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { target, floatPixels } from '../../gpu/rgba-readback'
export type ReplayInput = { clip: number[]; sides: number[]; smoothing: number; width: number; height: number }
export async function createReplay (type: 'webgl' | 'webgpu'):
Promise<{ draw(input: ReplayInput, linear?: boolean): Promise<Float32Array>; destroy(): void }> {
  const device = await createDevice(type, document.createElement('canvas'), false); const scope = resourceScope()
  try {
    const layout = { attributes: [], bindings: bindingLayout([['vertices', 'read-only-storage']]) }
    const array = type === 'webgpu' ? scope.own(device.createVertexArray({ shaderLayout: layout, bufferLayout: [] })) : undefined
    const kernels = new Map<boolean, RenderKernel>(); let model: Model | undefined
    return {
      async draw (input, linear = false): Promise<Float32Array> {
        const frame = resourceScope()
        try {
          const output = frame.own(target(device, input.width, input.height, 'rgba32float'))
          const vertices = input.sides.map((side, i) => [input.clip[i * 2], input.clip[i * 2 + 1], side, input.smoothing])
          if (type === 'webgl') {
            model ??= scope.own(new Model(device, {
              vs: `#version 300 es
                in vec2 replayPosition; in float replaySide; in float replayRamp;
                out float side; out float smoothing;
                void main() { gl_Position = vec4(replayPosition,0,1); side = replaySide; smoothing = replayRamp; }`,
              fs: `#version 300 es
                precision highp float;
                in float side; in float smoothing; out vec4 color;
                void main() { color = vec4(side,smoothing,smoothstep(0.5,0.5 - smoothing,abs(side)),1); }`,
              topology: 'triangle-strip',
              bufferLayout: [{ name: 'replayPosition', format: 'float32x2' }, { name: 'replaySide', format: 'float32' },
                { name: 'replayRamp', format: 'float32' }],
              parameters: { blend: false, cullMode: 'back', depthWriteEnabled: false, depthCompare: 'always' },
            }))
            const positions = frame.own(device.createBuffer({ data: new Float32Array(input.clip) }))
            const sides = frame.own(device.createBuffer({ data: new Float32Array(input.sides) }))
            const ramps = frame.own(device.createBuffer({ data: new Float32Array(input.sides.map(() => input.smoothing)) }))
            model.setAttributes({ replayPosition: positions, replaySide: sides, replayRamp: ramps }); model.setVertexCount(input.sides.length)
            const pass = device.beginRenderPass({ framebuffer: output.framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
            try { model.draw(pass) } finally { pass.end() }
          } else {
            let kernel = kernels.get(linear)
            if (!kernel) {
              const source = `@group(0) @binding(0) var<storage,read> vertices: array<vec4f>;
                struct V { @builtin(position) position: vec4f,
                  @location(0) ${linear ? '@interpolate(linear, center)' : ''} side: f32, @location(1) smoothing: f32 }
                @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> V {
                  let data = vertices[index]; var result: V; result.position = vec4f(data.xy,0,1);
                  result.side = data.z; result.smoothing = data.w; return result;
                }
                @fragment fn fragmentMain(input: V) -> @location(0) vec4f {
                  return vec4f(input.side,input.smoothing,smoothstep(0.5,0.5 - input.smoothing,abs(input.side)),1);
                }`
              kernel = scope.own(new RenderKernel(device, {
                vertexSource: source,
                fragmentSource: source,
                vertexEntryPoint: 'vertexMain',
                fragmentEntryPoint: 'fragmentMain',
                topology: 'triangle-strip',
                shaderLayout: layout,
                colorAttachmentFormats: ['rgba32float'],
                parameters: { blend: false, cullMode: 'back' },
              }))
              kernels.set(linear, kernel)
            }
            const buffer = frame.own(upload(device, new Float32Array(vertices.flat())))
            const pass = device.beginRenderPass({ framebuffer: output.framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
            try { kernel.draw(pass, { vertexArray: array!, vertexCount: input.sides.length, bindings: { vertices: buffer } }) } finally { pass.end() }
          }
          device.submit(); return await floatPixels(device, output.texture, output.framebuffer)
        } finally { frame.destroy() }
      },
      destroy (): void { try { scope.destroy() } finally { device.destroy() } },
    }
  } catch (error) { try { scope.destroy() } finally { device.destroy() }; throw error }
}
