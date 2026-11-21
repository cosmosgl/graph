import { Buffer, Texture, UniformStore, type Device, type Framebuffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import quad from '../../../../../src/modules/Shared/quad.vert?raw'
import interpolate from '../../../../../src/modules/Points/interpolate-position.frag?raw'
import exitRamp from '../../../../../src/modules/Points/exit-ramp.glsl?raw'
import drawPoints from '../../../../../src/modules/Points/draw-points.vert?raw'
import { upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import {
  POINT_TRANSITION_DEFAULT_COLOR, POINT_TRANSITION_DEFAULT_SIZE, transitionAttributes, transitionFlags,
  type PointTransitionData, type PointTransitionRunner, type PointTransitionOutput,
} from './transition-state'

function styleProbe (): string {
  const resolve = drawPoints.match(/vec4 resolveColor\(vec4 color, float exit\) \{[^}]+\}/)?.[0]
  const mix = drawPoints.match(/float pointSize = transitionedSize[^;]+;\s+vec4 pointColor = animateColors[^;]+;/)?.[0]
  if (!resolve || !mix) throw new Error('Production point transition probe anchors changed')
  // Run the production rules before drawing, writing their values to texels.
  return `#version 300 es
precision highp float;
uniform sampler2D pointProperties;
uniform sampler2D fromColor;
uniform sampler2D toColor;
layout(std140) uniform transitionStyleUniforms {
  vec4 frame;
  vec4 defaultColor;
  float defaultSize;
  float colorPass;
} style;
#define EXIT_DEFAULT_SIZE 0.0
#define EXIT_DEFAULT_COLOR_CHANNEL 0.0
${exitRamp}
#define transitionProgress style.frame.x
#define animatePositions style.frame.y
#define animateColors style.frame.z
#define animateSizes style.frame.w
#define pointDefaultColor style.defaultColor
#define pointDefaultSize style.defaultSize
out vec4 fragColor;
${resolve}
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 value = texelFetch(pointProperties, texel, 0);
  float exit = exitRamp(vec4(value.zw, 0., 0.), animatePositions, transitionProgress);
  if (exit >= 1.) {
    fragColor = style.colorPass > 0. ? vec4(0.) : vec4(0., exit, value.w, 0.);
    return;
  }
  float sourceSize = value.x;
  float targetSize = value.y;
  vec4 sourceColor = texelFetch(fromColor, texel, 0);
  vec4 targetColor = texelFetch(toColor, texel, 0);
  ${mix}
  fragColor = style.colorPass > 0. ? pointColor : vec4(pointSize, exit, value.w, pointSize > 0. ? 1. : 0.);
}`
}

export function createPointTransitionWebGL (device: Device, initial: PointTransitionData): PointTransitionRunner {
  const scope = resourceScope()
  const own = scope.own
  const edge = Math.sqrt(initial.sizes.length)
  if (!Number.isInteger(edge)) throw new Error('Transition fixture needs a square data texture')
  let previous = initial
  try {
    const write = (texture: Texture, data: Float32Array): void => { texture.copyImageData({ data, bytesPerRow: edge * 16 }) }
    const texture = (data: Float32Array): Texture => {
      const result = own(device.createTexture({
        width: edge,
        height: edge,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC | Texture.COPY_DST,
        sampler: { minFilter: 'nearest', magFilter: 'nearest' },
      }))
      write(result, data)
      return result
    }
    const position = texture(initial.positions)
    const source = texture(initial.positions); const target = texture(initial.positions)
    const fromColor = texture(initial.colors); const toColor = texture(initial.colors)
    const pointProperties = texture(transitionAttributes(initial, initial))
    const current = own(device.createFramebuffer({ width: edge, height: edge, colorAttachments: [position] }))
    const probe = own(device.createFramebuffer({ width: edge, height: edge, colorAttachments: [texture(initial.colors)] }))
    const vertices = own(upload(device, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), Buffer.VERTEX))
    const uniforms = own(new UniformStore(device, {
      interpolatePositionUniforms: { uniformTypes: { progress: 'f32' } },
      transitionStyleUniforms: { uniformTypes: { frame: 'vec4<f32>', defaultColor: 'vec4<f32>', defaultSize: 'f32', colorPass: 'f32' } },
    }))
    const render = {
      vs: quad,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: { vertexCoord: vertices },
      bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
      parameters: { blend: false, depthCompare: 'always', depthWriteEnabled: false, cullMode: 'none' },
    } as const
    const positionModel = own(new Model(device, {
      ...render,
      fs: interpolate,
      defines: { USE_UNIFORM_BUFFERS: true },
      bindings: { sourceTexture: source, targetTexture: target, interpolatePositionUniforms: uniforms.getManagedUniformBuffer('interpolatePositionUniforms') },
      bufferLayout: [...render.bufferLayout],
    }))
    const styleModel = own(new Model(device, {
      ...render,
      fs: styleProbe(),
      bufferLayout: [...render.bufferLayout],
      bindings: { pointProperties, fromColor, toColor, transitionStyleUniforms: uniforms.getManagedUniformBuffer('transitionStyleUniforms') },
    }))
    const draw = (model: Model, framebuffer: Framebuffer): void => {
      const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
      try { model.draw(pass) } finally { pass.end() }
    }
    // The tests inspect data texels in storage order, starting at GL's bottom row.
    const read = (framebuffer: Framebuffer): Float32Array => device.readPixelsToArrayWebGL(framebuffer) as Float32Array
    return {
      start (next): void {
        if (next.positions.length !== initial.positions.length) throw new Error('This transition study uses a fixed point count')
        const encoder = device.createCommandEncoder()
        encoder.copyTextureToTexture({ sourceTexture: position, destinationTexture: source, width: edge, height: edge })
        device.submit(encoder.finish())
        write(target, next.positions); write(fromColor, previous.colors); write(toColor, next.colors)
        write(pointProperties, transitionAttributes(previous, next)); previous = next
      },
      async draw (frame): Promise<PointTransitionOutput> {
        if (frame.positions) {
          uniforms.setUniforms({ interpolatePositionUniforms: { progress: frame.progress } })
          draw(positionModel, current)
        }
        const setPass = (colorPass: number): void => uniforms.setUniforms({
          transitionStyleUniforms: {
            frame: transitionFlags(frame), defaultColor: [...POINT_TRANSITION_DEFAULT_COLOR], defaultSize: POINT_TRANSITION_DEFAULT_SIZE, colorPass,
          },
        })
        setPass(0); draw(styleModel, probe); const metadata = read(probe)
        setPass(1); draw(styleModel, probe); const color = read(probe)
        const styles = new Float32Array(metadata.length * 2)
        for (let offset = 0; offset < metadata.length; offset += 4) {
          styles.set(metadata.subarray(offset, offset + 4), offset * 2)
          styles.set(color.subarray(offset, offset + 4), offset * 2 + 4)
        }
        return { positions: read(current), styles }
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
