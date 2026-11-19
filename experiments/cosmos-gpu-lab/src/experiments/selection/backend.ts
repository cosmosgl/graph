import { Buffer, Texture, UniformStore, type Device } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { Kernel } from '@luma.gl/graph'
import quad from '../../../../../src/modules/Shared/quad.vert?raw'
import rectFrag from '../../../../../src/modules/Points/find-points-in-rect.frag?raw'
import polygonFrag from '../../../../../src/modules/Points/find-points-in-polygon.frag?raw'
import pointSize from '../../../../../src/modules/Points/point-size.glsl?raw'
import { bindingLayout, upload, waitForGpu } from '../../gpu/luma'
import { target } from '../../gpu/rgba-readback'
import { resourceScope } from '../../gpu/resource-scope'
import type { Camera, Pair, Point, Query } from './reference'
import source from './selection.wgsl?raw'

type Select = (points: Point[], camera: Camera, query: Query) => Promise<number[]>
type Backend = { select: Select; destroy(): void }

function bounds (camera: Camera, [[left, top], [right, bottom]]: [Pair, Pair]): [Pair, Pair] {
  return [[left, camera.viewport[1] - bottom], [right, camera.viewport[1] - top]]
}

function pathForGpu ({ viewport }: Camera, path: Pair[]): Pair[] {
  return path.map(([x, y]) => [x, viewport[1] - y])
}

function indices (mask: ArrayLike<number>, count: number, stride = 1): number[] {
  const results: number[] = []
  for (let i = 0; i < count; i++) if (mask[i * stride] === 1) results.push(i)
  return results
}

export async function createSelectionWebGPU (device: Device): Promise<Backend> {
  const kernel = await Kernel.createAsync(device, {
    source,
    shaderLayout: {
      bindings: bindingLayout([
        ['points', 'read-only-storage'], ['path', 'read-only-storage'], ['selection', 'uniform'], ['selected', 'storage'],
      ]),
    },
  })
  return {
    async select (points, camera, query): Promise<number[]> {
      if (!points.length || ('polygon' in query && query.polygon.length < 3)) return []
      const { origin, viewport, translation, zoom, ratio, sizeScale, maxSize, scaleOnZoom } = camera
      const coords = 'rect' in query ? bounds(camera, query.rect).flat() : [0, 0, 0, 0]
      const path = 'polygon' in query ? pathForGpu(camera, query.polygon).flat() : []
      const params = new Float32Array(20)
      params.set([...origin, ...viewport, ...translation, zoom, ratio, ...coords, sizeScale, maxSize])
      new Uint32Array(params.buffer).set([Number(scaleOnZoom), points.length, path.length / 2, Number('polygon' in query)], 14)
      const scope = resourceScope(); const own = scope.own
      try {
        const bindings = {
          points: own(upload(device, Float32Array.from(points.flatMap(p => [...p.world, p.size, p.absent])))),
          path: own(upload(device, Float32Array.from(path))),
          selection: own(upload(device, params, Buffer.UNIFORM)),
          selected: own(upload(device, new Uint32Array(points.length).fill(2))),
        }
        const pass = device.beginComputePass()
        try { kernel.dispatch(pass, { x: Math.ceil(points.length / 64), bindings }) } finally { pass.end() }
        await waitForGpu(device)
        const bytes = await bindings.selected.readAsync(0, points.length * 4)
        const mask = new Uint32Array(bytes.buffer, bytes.byteOffset, points.length)
        if (mask.some(value => value !== 0 && value !== 1)) throw new Error('WebGPU left a selection flag unwritten')
        return indices(mask, points.length)
      } finally { scope.destroy() }
    },
    destroy: (): void => { kernel.destroy() },
  }
}

export function createSelectionWebGL (device: Device): Backend {
  const scope = resourceScope(); const own = scope.own
  try {
    if (!device.isTextureFormatRenderable('rgba32float')) throw new Error('RGBA32F rendering unavailable')
    const uniforms = own(new UniformStore(device, {
      findPointsInRectUniforms: {
        uniformTypes: {
          sizeScale: 'f32',
          worldOrigin: 'vec2<f32>',
          screenSize: 'vec2<f32>',
          ratio: 'f32',
          transformationMatrix: 'mat4x4<f32>',
          rect0: 'vec2<f32>',
          rect1: 'vec2<f32>',
          scalePointsOnZoom: 'f32',
          maxPointSize: 'f32',
        },
      },
      findPointsInPolygonUniforms: {
        uniformTypes: { worldOrigin: 'vec2<f32>', screenSize: 'vec2<f32>', transformationMatrix: 'mat4x4<f32>', polygonPathLength: 'f32' },
      },
    }))
    const vertex = own(upload(device, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), Buffer.VERTEX))
    const makeModel = (fs: string, uniform: string, withSize = false): Model => own(new Model(device, {
      id: uniform,
      vs: quad,
      fs,
      modules: withSize ? [{ name: 'pointSize', fs: pointSize }] : [],
      defines: { USE_UNIFORM_BUFFERS: true },
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: { vertexCoord: vertex },
      bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
      bindings: { [uniform]: uniforms.getManagedUniformBuffer(uniform) },
      parameters: { blend: false, depthCompare: 'always', depthWriteEnabled: false, cullMode: 'none' },
    }))
    const rect = makeModel(rectFrag, 'findPointsInRectUniforms', true)
    const polygon = makeModel(polygonFrag, 'findPointsInPolygonUniforms')
    return {
      async select (points, camera, query): Promise<number[]> {
        if (!points.length || ('polygon' in query && query.polygon.length < 3)) return []
        const { origin: worldOrigin, viewport: screenSize, translation: [tx, ty], zoom, ratio, sizeScale, maxSize, scaleOnZoom } = camera
        const transformationMatrix = [zoom, 0, 0, 0, 0, zoom, 0, 0, tx, ty, 1, 0, 0, 0, 0, 1]
        const passScope = resourceScope()
        try {
          const texture = (count: number, unpacked: number[]): Texture => {
            const width = Math.ceil(Math.sqrt(count))
            const texture = passScope.own(device.createTexture({
              width,
              height: width,
              format: 'rgba32float',
              usage: Texture.SAMPLE | Texture.COPY_DST,
              sampler: { minFilter: 'nearest', magFilter: 'nearest' },
            }))
            const data = new Float32Array(width * width * 4)
            data.set(unpacked)
            texture.copyImageData({ data, bytesPerRow: width * 16, mipLevel: 0, x: 0, y: 0 })
            return texture
          }
          const positionsTexture = texture(points.length, points.flatMap(p => [...p.world, 0, 0]))
          const exitTexture = texture(points.length, points.flatMap(p => [0, p.absent, 0, 0]))
          const shared = { worldOrigin, screenSize, transformationMatrix }
          const model = 'rect' in query ? rect : polygon
          if ('rect' in query) {
            const [rect0, rect1] = bounds(camera, query.rect)
            uniforms.setUniforms({
              findPointsInRectUniforms: { ...shared, rect0, rect1, sizeScale, ratio, scalePointsOnZoom: Number(scaleOnZoom), maxPointSize: maxSize },
            })
            const pointSize = texture(points.length, points.flatMap(p => [p.size, 0, 0, 0]))
            model.setBindings({ positionsTexture, exitTexture, pointSize })
          } else {
            const path = pathForGpu(camera, query.polygon)
            uniforms.setUniforms({ findPointsInPolygonUniforms: { ...shared, polygonPathLength: path.length } })
            const polygonPathTexture = texture(path.length, path.flatMap(point => [...point, 0, 0]))
            model.setBindings({ positionsTexture, exitTexture, polygonPathTexture })
          }
          const { framebuffer } = passScope.own(target(device, positionsTexture.width, positionsTexture.height, 'rgba32float'))
          const pass = device.beginRenderPass({ framebuffer, clearColor: [0.5, 0, 0, 0], clearDepth: false })
          try { model.draw(pass) } finally { pass.end() }
          const rgba = device.readPixelsToArrayWebGL(framebuffer) as Float32Array
          if (points.some((_, i) => rgba[i * 4] !== 0 && rgba[i * 4] !== 1)) throw new Error('WebGL left a selection flag unwritten')
          return indices(rgba, points.length, 4)
        } finally { passScope.destroy() }
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
