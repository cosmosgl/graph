import { Buffer, Texture, type Device } from '@luma.gl/core'
import { GPUCommandGraph, Kernel, type GraphDataView } from '@luma.gl/graph'
import { GPUCompaction } from '@luma.gl/graph/gpu-core'
import { bindingLayout, createStorageRenderer, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { TimestampWrites } from '../many-body/timing'
import { residentProjection } from './resident-projection'

const groupSize = 256
const samplesPerWord = 32

const packSource = (width: number, rowWords: number): string => `
@group(0) @binding(0) var covered: texture_2d<u32>;
@group(0) @binding(1) var<storage, read_write> words: array<u32>;
@compute @workgroup_size(${groupSize}) fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= arrayLength(&words)) { return; }
  let y = index / ${rowWords}u;
  let x = (index % ${rowWords}u) * 32u;
  var word = 0u;
  for (var bit = 0u; bit < min(${width}u - x, 32u); bit++) {
    let owner = textureLoad(covered, vec2i(i32(x + bit), i32(y)), 0).x;
    word |= select(0u, 1u << bit, owner != 0u);
  }
  words[index] = word;
}`

const flagsSource = (rowWords: number, firstCoverId: number): string => `
${residentProjection}
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read> words: array<u32>;
@group(0) @binding(4) var<storage, read_write> flags: array<u32>;

fn laterPointsCover(lo: vec2u, hi: vec2u) -> bool {
  let first = lo.x / 32u;
  let last = hi.x / 32u;
  let leftMask = 0xffffffffu << (lo.x % 32u);
  let rightMask = 0xffffffffu >> (31u - hi.x % 32u);
  for (var y = lo.y; y <= hi.y; y++) {
    let row = y * ${rowWords}u;
    if (first == last) {
      let mask = leftMask & rightMask;
      if ((words[row + first] & mask) != mask) { return false; }
    } else {
      if ((words[row + first] & leftMask) != leftMask || (words[row + last] & rightMask) != rightMask) { return false; }
      for (var word = first + 1u; word < last; word++) {
        if (words[row + word] != 0xffffffffu) { return false; }
      }
    }
  }
  return true;
}

fn keep(index: u32) -> bool {
  let p = positions[index];
  if (p.w > 0.5) { return false; }
  let clip = project(p.xy);
  let screen = (vec2f(0.5) + clip * vec2f(0.5, -0.5)) * display.xy;
  // Include every possible sprite sample, with extra room for transform and
  // raster rounding. Edge points remain eligible if any sample reaches the view.
  let margin = vec2f(2.5 * display.z + 0.015625);
  if (!all(abs(screen) < vec2f(1e9)) || !all(margin < vec2f(1e9))) { return true; }
  let lo = max(vec2f(0.), ceil(screen - margin - vec2f(0.5)));
  let hi = min(display.xy - vec2f(1.), floor(screen + margin - vec2f(0.5)));
  if (any(lo > hi)) { return false; }
  // A point can only be hidden by the suffix when every sample in its
  // rectangle is already covered by the same rasterizer.
  return index >= ${firstCoverId}u || !laterPointsCover(vec2u(lo), vec2u(hi));
}

@compute @workgroup_size(${groupSize}) fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index < arrayLength(&flags)) { flags[index] = select(0u, 1u, keep(index)); }
}`

type ResidentPointCulling = {
  readonly visibleIds: Buffer;
  readonly drawArgs: Buffer;
  encode(positions: Buffer, timestamps?: TimestampWrites): void;
  drawnCount(): Promise<number>;
  destroy(): void;
}

export async function createResidentPointCulling (
  device: Device, count: number, view: Buffer, display: Buffer, width: number, height: number, coverSource: string
): Promise<ResidentPointCulling> {
  const scope = resourceScope(); const own = scope.own
  try {
    const coverCount = Math.ceil(count / 8)
    const firstCoverId = count - coverCount
    const rowWords = Math.ceil(width / samplesPerWord)
    const storage = (size: number): Buffer => own(device.createBuffer({ byteLength: size * 4, usage: Buffer.STORAGE }))
    const words = storage(rowWords * height)
    const flags = storage(count)
    const visibleIds = storage(count)
    const orderedIds = own(upload(device, Uint32Array.from({ length: count }, (_, index) => index)))
    const drawArgs = own(upload(device, new Uint32Array([6, 0, 0, 0]), Buffer.STORAGE | Buffer.INDIRECT))
    const covered = own(device.createTexture({ width, height, format: 'r32uint', usage: Texture.RENDER | Texture.SAMPLE }))
    const framebuffer = own(device.createFramebuffer({ width, height, colorAttachments: [covered] }))
    const cover = own(createStorageRenderer(device, coverSource, 'triangle-list', bindingLayout([
      ['positions', 'read-only-storage'], ['view', 'read-only-storage'], ['display', 'uniform'],
    ]), {}, undefined, framebuffer))
    const pack = own(await Kernel.createAsync(device, {
      source: packSource(width, rowWords),
      shaderLayout: {
        bindings: [
          { name: 'covered', location: 0, group: 0, type: 'texture', sampleType: 'uint', viewDimension: '2d' },
          { name: 'words', location: 1, group: 0, type: 'storage' },
        ],
      },
    }))
    const keep = own(await Kernel.createAsync(device, {
      source: flagsSource(rowWords, firstCoverId),
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['view', 'read-only-storage'], ['display', 'uniform'],
          ['words', 'read-only-storage'], ['flags', 'storage'],
        ]),
      },
    }))
    const graph = new GPUCommandGraph(device)
    const dataView = (id: string, buffer: Buffer, length: number, byteOffset = 0): GraphDataView<'uint32'> => {
      const imported = graph.importBuffer({ id, byteLength: buffer.byteLength, usage: buffer.usage }, buffer)
      return graph.createDataView(imported, { format: 'uint32', length, byteOffset })
    }
    graph.add(new GPUCompaction({
      input: dataView('point-ids', orderedIds, count),
      flags: dataView('keep-flags', flags, count),
      output: dataView('ordered-visibility', visibleIds, count),
      count: dataView('draw-arguments', drawArgs, 1, 4),
    }))
    const compact = own(await graph.compileAsync())
    const groups = Math.ceil(count / groupSize)
    return {
      visibleIds,
      drawArgs,
      encode (positions, timestamps): void {
        const bindings = { positions, view, display }
        const coverage = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false, ...timestamps })
        try {
          cover.kernel.draw(coverage, {
            vertexArray: cover.vertexArray, vertexCount: 6, firstInstance: firstCoverId, instanceCount: coverCount, bindings,
          })
        } finally { coverage.end() }
        const pass = device.beginComputePass()
        try {
          pack.dispatch(pass, { x: Math.ceil(rowWords * height / groupSize), bindings: { covered, words } })
          keep.dispatch(pass, { x: groups, bindings: { ...bindings, words, flags } })
        } finally { pass.end() }
        compact.encode(device.commandEncoder, { parameters: undefined })
      },
      async drawnCount (): Promise<number> {
        const bytes = await drawArgs.readAsync(4, 4)
        return coverCount + new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true)
      },
      destroy (): void { scope.destroy() },
    }
  } catch (error) { scope.destroy(); throw error }
}
