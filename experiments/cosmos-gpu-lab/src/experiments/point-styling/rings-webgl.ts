import { UniformStore, type Device, type RenderPass, type Texture } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import vs from '../../../../../src/modules/Points/draw-highlighted.vert?raw'
import fs from '../../../../../src/modules/Points/draw-highlighted.frag?raw'
import pointSize from '../../../../../src/modules/Points/point-size.glsl?raw'
import exitRamp from '../../../../../src/modules/Points/exit-ramp.glsl?raw'
import { ALPHA_BLEND } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { HEIGHT, WIDTH, type Point, type Settings } from './data'
import { overlayIndices } from './point-effects'
import { atlasInfo } from './atlas'

// Verbatim production hover/focus shaders and std140 declaration order.
export function createPointOverlays (device: Device): {
  draw(pass: RenderPass, bindings: Record<'positionsTexture' | 'pointStatus' | 'exitTexture', Texture>, points: Point[], settings: Settings): void;
  destroy(): void;
} {
  const scope = resourceScope()
  try {
    const uniforms = scope.own(new UniformStore(device, {
      drawHighlightedUniforms: {
        uniformTypes: {
          sourceSize: 'f32',
          targetSize: 'f32',
          imageSize: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          pointsTextureSize: 'f32',
          sizeScale: 'f32',
          worldOrigin: 'vec2<f32>',
          screenSize: 'vec2<f32>',
          scalePointsOnZoom: 'f32',
          pointIndex: 'f32',
          maxPointSize: 'f32',
          color: 'vec4<f32>',
          universalPointOpacity: 'f32',
          greyoutOpacity: 'f32',
          isDarkenGreyout: 'f32',
          backgroundColor: 'vec4<f32>',
          greyoutColor: 'vec4<f32>',
          animatePositions: 'f32',
          transitionProgress: 'f32',
          animateSizes: 'f32',
          pointDefaultSize: 'f32',
          width: 'f32',
          pixelRatio: 'f32',
        },
      },
    }))
    const buffer = scope.own(device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }))
    const model = scope.own(new Model(device, {
      vs,
      fs,
      topology: 'triangle-strip',
      vertexCount: 4,
      modules: [{ name: 'pointSize', vs: pointSize, fs: pointSize }, { name: 'exitRamp', vs: exitRamp }],
      defines: {
        USE_UNIFORM_BUFFERS: true,
        ...({
          EXIT_DEFAULT_SIZE: '0.0',
          EXIT_DEFAULT_COLOR_CHANNEL: '0.0',
          EDGE_RAMP_PX: '1.0',
          POINT_RING_SCALE: '1.3',
        } as unknown as Record<string, boolean>),
      },
      bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
      attributes: { vertexCoord: buffer },
      bindings: { drawHighlightedUniforms: uniforms.getManagedUniformBuffer('drawHighlightedUniforms') },
      parameters: { ...ALPHA_BLEND, depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' },
    }))
    return {
      draw (pass, bindings, points, settings): void {
        const count = settings.atlasSource?.images.length ?? atlasInfo(settings.atlasPacking).imageCount
        model.setBindings({ positionsTexture: bindings.positionsTexture, pointStatus: bindings.pointStatus, exitTexture: bindings.exitTexture })
        for (const ring of overlayIndices(settings, points.length)) {
          const p = points[ring.index]; const hasImage = p.image !== undefined && p.image >= 0 && p.image < count
          uniforms.setUniforms({
            drawHighlightedUniforms: {
              sourceSize: p.size,
              targetSize: p.size,
              imageSize: hasImage ? p.imageSize ?? p.size : 0,
              transformationMatrix: [settings.zoom, 0, 0, 0, 0, settings.zoom, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              pointsTextureSize: Math.max(1, Math.ceil(Math.sqrt(points.length))),
              sizeScale: settings.sizeScale,
              worldOrigin: [0, 0],
              screenSize: [WIDTH, HEIGHT],
              scalePointsOnZoom: Number(settings.scaleOnZoom),
              pointIndex: ring.index,
              maxPointSize: settings.maxSize,
              color: ring.color,
              universalPointOpacity: settings.opacity,
              greyoutOpacity: settings.greyoutOpacity ?? -1,
              isDarkenGreyout: Number(settings.darkenGreyout !== false),
              backgroundColor: settings.backgroundColor ?? [0, 0, 0, 0],
              greyoutColor: settings.greyoutColor ?? [-1, -1, -1, -1],
              animatePositions: 0,
              transitionProgress: 1,
              animateSizes: 0,
              pointDefaultSize: settings.defaultSize,
              width: 0.85,
              pixelRatio: settings.ratio,
            },
          })
          model.draw(pass)
        }
      },
      destroy (): void { scope.destroy() },
    }
  } catch (error) { scope.destroy(); throw error }
}
