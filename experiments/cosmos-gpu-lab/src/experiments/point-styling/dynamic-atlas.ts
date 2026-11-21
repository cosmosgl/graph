import { Texture, type Device } from '@luma.gl/core'
import type { AtlasImage, AtlasLayout } from './atlas-packing'

function copyImage (image: AtlasImage): AtlasImage {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
    image.bytes.length !== image.width * image.height * 4) throw new Error('Expected nonempty, tightly packed RGBA8 image')
  return { ...image, bytes: image.bytes.slice() }
}
function blit (layout: AtlasLayout, index: number): void {
  const image = layout.images[index]; const rect = layout.rects[index]
  for (let y = 0; y < image.height; y++) {
    layout.bytes.set(image.bytes.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((rect.y + y) * layout.width + rect.x) * 4)
  }
}
// Independent production-grid construction. Tests compare the packed bytes/UVs
// with Cosmos's actual packer; these small fixtures do not require resampling.
export function packDynamicImages (sources: readonly AtlasImage[]): AtlasLayout {
  const images = sources.map(copyImage); const columns = Math.max(1, Math.ceil(Math.sqrt(images.length)))
  const cell = Math.max(1, ...images.map(image => Math.max(image.width, image.height))); const width = columns * cell
  const layout: AtlasLayout = {
    width,
    height: width,
    bytes: new Uint8Array(width * width * 4),
    coords: new Float32Array(columns * columns * 4).fill(-1),
    coordsSize: columns,
    images,
    rects: [],
    columns,
    rows: columns,
    cell,
  }
  images.forEach((image, index) => {
    const x = index % columns * cell; const y = Math.floor(index / columns) * cell
    layout.rects.push({ x, y, width: image.width, height: image.height })
    layout.coords.set([x / width, y / width, (x + image.width) / width, (y + image.height) / width], index * 4)
    blit(layout, index)
  })
  return layout
}
export type AtlasMutation = {
  generation: number; operation: 'replace' | 'image upload' | 'restore'; width: number; height: number; images: number;
  allocatedTextures: number; releasedTextures: number; liveTextures: number; uploadedBytes: number;
}
export type DynamicAtlas = {
  readonly layout: AtlasLayout | undefined; readonly generation: number;
  replace(images?: readonly AtlasImage[], options?: { external?: boolean }): AtlasMutation;
  updateImage(index: number, image: AtlasImage): AtlasMutation;
  texture(filter: 'nearest' | 'linear'): Texture;
  destroy(): void;
}
export function createDynamicAtlas (device: Device): DynamicAtlas {
  let layout: AtlasLayout | undefined; let generation = 0; let destroyed = false
  let textures: Texture[] = []
  const check = (): void => { if (destroyed) throw new Error('Dynamic atlas destroyed') }
  const result = (operation: AtlasMutation['operation'], allocatedTextures: number, releasedTextures: number, uploadedBytes: number): AtlasMutation => ({
    generation,
    operation,
    width: layout?.width ?? 0,
    height: layout?.height ?? 0,
    images: layout?.images.length ?? 0,
    allocatedTextures,
    releasedTextures,
    liveTextures: textures.length,
    uploadedBytes,
  })
  return {
    get layout (): AtlasLayout | undefined { return layout },
    get generation (): number { return generation },
    replace (images, options): AtlasMutation {
      check()
      const next = images ? packDynamicImages(images) : undefined; const created: Texture[] = []
      try {
        if (next) {
          for (const filter of ['nearest', 'linear'] as const) {
            const texture = device.createTexture({
              width: next.width,
              height: next.height,
              format: 'rgba8unorm',
              usage: Texture.SAMPLE | Texture.COPY_DST | (options?.external ? Texture.RENDER : 0),
              sampler: { minFilter: filter, magFilter: filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
            })
            created.push(texture)
            texture.writeData(next.bytes, { bytesPerRow: next.width * 4, width: next.width, height: next.height })
          }
        }
      } catch (error) { created.forEach(texture => texture.destroy()); throw error }
      const previous = textures; textures = created; layout = next; generation++
      previous.forEach(texture => texture.destroy())
      return result(images ? 'replace' : 'restore', created.length, previous.length, next ? next.bytes.length * created.length : 0)
    },
    updateImage (index, source): AtlasMutation {
      check()
      if (!layout || !Number.isInteger(index) || !layout.images[index]) throw new Error('No image at this atlas index')
      const image = copyImage(source); const original = layout.images[index]
      if (image.width !== original.width || image.height !== original.height) throw new Error('Changed image dimensions require atlas replacement')
      const next = { ...layout, bytes: layout.bytes.slice(), images: layout.images.slice() }; next.images[index] = image; blit(next, index)
      const rect = next.rects[index]
      // Update both sampler resources so switching filters cannot reveal an old image.
      for (const texture of textures) {
        texture.writeData(image.bytes, {
          x: rect.x, y: rect.y, width: image.width, height: image.height, bytesPerRow: image.width * 4,
        })
      }
      layout = next; generation++
      return result('image upload', 0, 0, image.bytes.length * textures.length)
    },
    texture (filter): Texture { check(); if (!textures.length) throw new Error('No dynamic atlas'); return textures[filter === 'nearest' ? 0 : 1] },
    destroy (): void { if (!destroyed) { textures.forEach(texture => texture.destroy()); textures = []; layout = undefined; destroyed = true } },
  }
}
