import { Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import type { WebGLForceFactory } from '../many-body/webgl'
import { resourceScope } from '../../gpu/resource-scope'
import forceSource from '../../../../../src/modules/ForceCollision/force-collision-allpairs.frag?raw'
import quadSource from '../../../../../src/modules/Shared/quad.vert?raw'
import { maxRadius, validateCollision, validateSizes, type CollisionParameters } from './data'
const drawVertex = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D positions; uniform sampler2D sizes;
layout(std140) uniform collisionDraw { vec4 view; float size; float radius; float padding; };
out vec2 uv; out vec3 color;
void main() {
  vec2 corners[6] = vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
  ivec2 texel = ivec2(gl_InstanceID % int(size), gl_InstanceID / int(size));
  vec4 p = texelFetch(positions, texel, 0); uv = corners[gl_VertexID];
  float r = (radius > 0. ? radius : texelFetch(sizes, texel, 0).r * 0.5) + padding;
  gl_Position = p.w > 0.5 ? vec4(3.,3.,0.,1.) : vec4((p.xy - view.xy + uv * r) * view.zw,0.,1.);
  color = p.z > 0.5 ? vec3(0.91,0.72,0.51) : vec3(0.62,0.71,0.84);
}`
const drawFragment = `#version 300 es
precision highp float;
in vec2 uv; in vec3 color; out vec4 outputColor;
void main() { float d = length(uv); if (d > 1.) discard; outputColor = vec4(color * (d > 0.88 ? 1. : 0.4),1.); }`
export function createCollisionWebGL (
  resources: Parameters<WebGLForceFactory>[0], sizes: Float32Array, settings: CollisionParameters
): { render: NonNullable<ReturnType<WebGLForceFactory>['render']>; sizes: Texture; encode(source: number, alpha: number): void; destroy(): void } {
  const { device, count, size, positions, exit, target } = resources
  validateSizes(sizes, count); validateCollision(settings)
  const scope = resourceScope(); const own = scope.own
  try {
    const data = new Float32Array(size * size * 4); for (let i = 0; i < count; i++) data[i * 4] = sizes[i]
    const sizeTexture = own(device.createTexture({
      width: size,
      height: size,
      format: 'rgba32float',
      usage: Texture.SAMPLE | Texture.COPY_DST,
      sampler: { minFilter: 'nearest', magFilter: 'nearest' },
    }))
    sizeTexture.copyImageData({ data, bytesPerRow: size * 16, mipLevel: 0, x: 0, y: 0 })
    const uniforms = own(new UniformStore(device, {
      forceCollisionAllPairsUniforms: {
        uniformTypes: {
          pointsTextureSize: 'f32',
          pointsNumber: 'f32',
          collisionStrength: 'f32',
          collisionRadius: 'f32',
          collisionPadding: 'f32',
          maxRadius: 'f32',
          alpha: 'f32',
          collisionCooling: 'f32',
        },
      },
    }))
    const quad = own(device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }))
    const parameters = { blend: false, depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' } as const
    const force = own(new Model(device, {
      vs: quadSource,
      fs: forceSource,
      defines: { USE_UNIFORM_BUFFERS: true },
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: { vertexCoord: quad },
      bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
      bindings: { forceCollisionAllPairsUniforms: uniforms.getManagedUniformBuffer('forceCollisionAllPairsUniforms') },
      parameters,
    }))
    const drawUniforms = own(new UniformStore(device, {
      collisionDraw: {
        uniformTypes: {
          view: 'vec4<f32>', size: 'f32', radius: 'f32', padding: 'f32',
        },
      },
    }))
    const draw = own(new Model(device, {
      vs: drawVertex,
      fs: drawFragment,
      topology: 'triangle-list',
      vertexCount: 6,
      instanceCount: count,
      parameters,
      bindings: { collisionDraw: drawUniforms.getManagedUniformBuffer('collisionDraw'), sizes: sizeTexture },
    }))
    return {
      sizes: sizeTexture,
      encode (source, alpha): void {
        uniforms.setUniforms({
          forceCollisionAllPairsUniforms: {
            pointsTextureSize: size,
            pointsNumber: count,
            collisionStrength: settings.strength,
            collisionRadius: settings.radius,
            collisionPadding: settings.padding,
            maxRadius: maxRadius(sizes, settings),
            alpha,
            collisionCooling: settings.cooling,
          },
        })
        force.setBindings({ positionsTexture: positions[source], sizeTexture, exitTexture: exit })
        const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0], clearDepth: false })
        try { force.draw(pass) } finally { pass.end() }
      },
      render (source, view, pass): void {
        drawUniforms.setUniforms({ collisionDraw: { view, size, radius: settings.radius, padding: settings.padding } })
        draw.setBindings({ positions: positions[source] }); draw.draw(pass)
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
