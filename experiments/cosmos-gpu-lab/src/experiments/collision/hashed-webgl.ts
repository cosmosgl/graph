import { Texture, UniformStore, type Buffer, type Framebuffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { collisionRotationSeed, withCollisionGrid } from '../../../../../src/modules/ForceCollision/collision-grid'
import forceSource from '../../../../../src/modules/ForceCollision/force-collision-slots.frag?raw'
import peelVertex from '../../../../../src/modules/ForceManyBody/build-nearfield-slots.vert?raw'
import peelFragment from '../../../../../src/modules/ForceManyBody/build-nearfield-slots.frag?raw'
import { createIndexesForBuffer } from '../../../../../src/modules/Shared/buffer'
import quadSource from '../../../../../src/modules/Shared/quad.vert?raw'
import { resourceScope } from '../../gpu/resource-scope'
import { PARAMETERS } from '../many-body/data'
import type { Snapshot } from '../many-body/reference'
import { createWebGL, type WebGLForceFactory } from '../many-body/webgl'
import type { CollisionParameters } from './data'
import { collisionSlotGrid, type CollisionOrigin, type CollisionSlotFrame } from './hashed-grid'

const parameters = { blend: false, depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' } as const
const inspectSource = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2DArray slotsTexture;
layout(std140) uniform inspectSlots { int layer; };
out vec4 color;
void main() { color = vec4(texelFetch(slotsTexture, ivec3(ivec2(gl_FragCoord.xy), layer), 0).rg, 0.0, 0.0); }`

type SlotReadback = { ids: Uint32Array; hashes: Float32Array }

function createSlotPasses (
  resources: Parameters<WebGLForceFactory>[0], sizes: Float32Array, settings: CollisionParameters, origin: CollisionOrigin
): { encode(source: number, frame: CollisionSlotFrame): void; readSlots(): SlotReadback; destroy(): void } {
  const { device, positions, exit, target, count, size } = resources
  const { edge, capacity, cellsPerUnit } = collisionSlotGrid(sizes, settings, origin)
  const scope = resourceScope(); const own = scope.own
  try {
    const pointIndices = own(device.createBuffer({ data: createIndexesForBuffer(size) }))
    const quad = own(device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }))
    const sizeData = new Float32Array(size * size * 4)
    sizes.forEach((value, index) => { sizeData[index * 4] = value })
    const sizeTexture = own(device.createTexture({ width: size, height: size, format: 'rgba32float', usage: Texture.SAMPLE | Texture.COPY_DST }))
    sizeTexture.copyImageData({ data: sizeData, bytesPerRow: size * 16, mipLevel: 0, x: 0, y: 0 })

    // Use the same formats, alternating depth targets and published array as
    // ForceCollision. In particular, the depth attachment breaks hash ties.
    const peels = Array.from({ length: 2 }, () => {
      const texture = own(device.createTexture({
        width: edge, height: edge, format: 'rg32float', usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC,
      }))
      const framebuffer = own(device.createFramebuffer({
        width: edge, height: edge, colorAttachments: [texture], depthStencilAttachment: 'depth24plus',
      }))
      return { texture, framebuffer }
    })
    const slotsTexture = own(device.createTexture({
      dimension: '2d-array', width: edge, height: edge, depth: capacity, format: 'rg32float', usage: Texture.SAMPLE | Texture.COPY_DST,
    }))
    const peelUniforms = own(new UniformStore(device, {
      buildNearFieldSlotsUniforms: {
        uniformTypes: {
          pointsTextureSize: 'f32',
          levelGridSize: 'f32',
          hasPreviousSlot: 'f32',
          randomSeed: 'f32',
          cellsPerUnit: 'f32',
          rotationSeed: 'f32',
          collisionOrigin: 'vec2<f32>',
        },
      },
    }))
    const peel = own(new Model(device, {
      vs: withCollisionGrid(peelVertex),
      fs: peelFragment,
      topology: 'point-list',
      vertexCount: count,
      attributes: { pointIndices },
      bufferLayout: [{ name: 'pointIndices', format: 'float32x2' }],
      defines: { USE_UNIFORM_BUFFERS: true, COLLISION_SLOTS: true },
      bindings: { buildNearFieldSlotsUniforms: peelUniforms.getManagedUniformBuffer('buildNearFieldSlotsUniforms'), exitTexture: exit },
      parameters: { ...parameters, depthWriteEnabled: true, depthCompare: 'less' },
    }))
    const makeQuad = (fs: string, bindings: Record<string, Texture | Buffer>): Model => own(new Model(device, {
      vs: quadSource,
      fs,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: { vertexCoord: quad },
      bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
      defines: { USE_UNIFORM_BUFFERS: true },
      bindings,
      parameters,
    }))
    const forceUniforms = own(new UniformStore(device, {
      forceCollisionSlotsUniforms: {
        uniformTypes: {
          pointsTextureSize: 'f32',
          gridSize: 'f32',
          slotCount: 'f32',
          collisionStrength: 'f32',
          collisionRadius: 'f32',
          collisionPadding: 'f32',
          alpha: 'f32',
          collisionCooling: 'f32',
          cellsPerUnit: 'f32',
          rotationSeed: 'f32',
          collisionOrigin: 'vec2<f32>',
        },
      },
    }))
    const force = makeQuad(withCollisionGrid(forceSource), {
      forceCollisionSlotsUniforms: forceUniforms.getManagedUniformBuffer('forceCollisionSlotsUniforms'), sizeTexture, exitTexture: exit, slotsTexture,
    })

    // Read the actual published array without changing the production RG32F
    // render targets. RGBA32F is the Lab's portable WebGL readback format.
    const probeTexture = own(device.createTexture({ width: edge, height: edge, format: 'rgba32float', usage: Texture.RENDER | Texture.COPY_SRC }))
    const probeTarget = own(device.createFramebuffer({ width: edge, height: edge, colorAttachments: [probeTexture] }))
    const probeUniforms = own(new UniformStore(device, { inspectSlots: { uniformTypes: { layer: 'i32' } } }))
    const probe = makeQuad(inspectSource, { slotsTexture, inspectSlots: probeUniforms.getManagedUniformBuffer('inspectSlots') })
    const drawQuad = (model: Model, framebuffer: Framebuffer): void => {
      const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
      try { model.draw(pass) } finally { pass.end() }
    }
    return {
      encode (source, frame): void {
        const rotationSeed = collisionRotationSeed(frame.tick)
        const collisionOrigin = [...origin] as [number, number]
        const positionsTexture = positions[source]
        for (let layer = 0; layer < capacity; layer++) {
          const peelTarget = peels[layer % 2]
          peelUniforms.setUniforms({
            buildNearFieldSlotsUniforms: {
              pointsTextureSize: size,
              levelGridSize: edge,
              hasPreviousSlot: Number(layer !== 0),
              randomSeed: frame.seed,
              cellsPerUnit,
              rotationSeed,
              collisionOrigin,
            },
          })
          peel.setBindings({ positionsTexture, previousSlot: layer === 0 ? positionsTexture : peels[(layer + 1) % 2].texture })
          const pass = device.beginRenderPass({ framebuffer: peelTarget.framebuffer, clearColor: [-1, 1, 0, 0], clearDepth: 1 })
          try { peel.draw(pass) } finally { pass.end() }
          const copy = device.createCommandEncoder()
          copy.copyTextureToTexture({ sourceTexture: peelTarget.texture, destinationTexture: slotsTexture, destinationOrigin: [0, 0, layer] })
          device.submit(copy.finish())
        }
        forceUniforms.setUniforms({
          forceCollisionSlotsUniforms: {
            pointsTextureSize: size,
            gridSize: edge,
            slotCount: capacity,
            collisionStrength: settings.strength,
            collisionRadius: settings.radius,
            collisionPadding: settings.padding,
            alpha: frame.alpha,
            collisionCooling: settings.cooling,
            cellsPerUnit,
            rotationSeed,
            collisionOrigin,
          },
        })
        force.setBindings({ positionsTexture })
        drawQuad(force, target)
      },
      readSlots (): SlotReadback {
        const ids = new Uint32Array(edge * edge * capacity)
        const hashes = new Float32Array(ids.length)
        for (let layer = 0; layer < capacity; layer++) {
          probeUniforms.setUniforms({ inspectSlots: { layer } })
          drawQuad(probe, probeTarget)
          const bytes = probeTexture.readDataSyncWebGL()
          const rgba = bytes instanceof ArrayBuffer ? new Float32Array(bytes) : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
          for (let bucket = 0; bucket < edge * edge; bucket++) {
            const id = rgba[bucket * 4]
            if (!Number.isInteger(id) || id < -1 || id >= count) throw new Error(`Invalid WebGL slot ${layer} in bucket ${bucket}: ${id}`)
            const offset = bucket * capacity + layer
            ids[offset] = id + 1
            hashes[offset] = rgba[bucket * 4 + 1]
          }
        }
        return { ids, hashes }
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}

// The shared Lab WebGL backend supplies the production position integrator
// and preserves the fixture's pin and absence textures through the comparison.
export async function createCollisionSlotsWebGL (
  points: Float32Array, sizes: Float32Array, settings: CollisionParameters, origin: CollisionOrigin
): Promise<{
  info: string;
  setPositions(points: Float32Array): void;
  step(frame: CollisionSlotFrame): void;
  read(): Promise<Snapshot>;
  readSlots(): SlotReadback;
  destroy(): void;
}> {
  if (points.length !== sizes.length * 4) throw new Error('Collision slot positions and sizes disagree')
  let passes!: ReturnType<typeof createSlotPasses>
  let frame!: CollisionSlotFrame
  const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
  const backend = await createWebGL(canvas, { points, samples: new Float32Array(sizes.length * 2) }, { ...PARAMETERS, friction: 1 }, resources => {
    passes = createSlotPasses(resources, sizes, settings, origin)
    return { encode (source): void { passes.encode(source, frame) }, destroy: passes.destroy }
  })
  return {
    info: backend.info,
    setPositions: backend.setPositions,
    step (next): void { frame = next; backend.step() },
    read: backend.read,
    readSlots: passes.readSlots,
    destroy: backend.destroy,
  }
}
