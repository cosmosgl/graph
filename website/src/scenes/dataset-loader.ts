import { siteUrl } from '../site-urls'

interface GraphDataset {
  positions: Float32Array;
  links: Uint32Array;
}

const signature = 0x31444743 // CGD1, little endian
const headerBytes = 16

/** Decode the packed channels directly as views over a single little-endian buffer. */
function decodeDataset (bytes: ArrayBuffer, pointCount: number, linkCount: number): GraphDataset {
  const invalid = (): never => { throw new Error('The dataset file does not match this study.') }
  if (bytes.byteLength < headerBytes) invalid()
  const header = new DataView(bytes)
  const points = header.getUint32(4, true)
  const links = header.getUint32(8, true)
  const flags = header.getUint32(12, true)
  const expected = headerBytes + 8 * (points + links)
  if (header.getUint32(0, true) !== signature || flags !== 0 || !points || points > 2 ** 24 ||
      points !== pointCount || links !== linkCount || bytes.byteLength !== expected) invalid()
  const positions = new Float32Array(bytes, headerBytes, points * 2)
  const indices = new Uint32Array(bytes, headerBytes + points * 8, links * 2)
  if (positions.some(value => !Number.isFinite(value)) || indices.some(value => value >= points)) invalid()
  return { positions, links: indices }
}

export async function loadDatasetBytes (file: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const configured = import.meta.env.VITE_DATASETS_BASE_URL?.trim()
  const base = configured ? new URL(`${configured.replace(/\/+$/, '')}/`, location.origin) : new URL(siteUrl('datasets/'), location.origin)
  const response = await fetch(new URL(file, base), { signal })
  if (!response.ok) throw new Error(`Could not load the dataset (HTTP ${response.status}).`)
  let bytes = await response.arrayBuffer()
  signal?.throwIfAborted()
  // A CDN may transparently decode a gzip object if Content-Encoding is set.
  const marker = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength))
  if (marker[0] === 0x1f && marker[1] === 0x8b) {
    bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'), { signal })).arrayBuffer()
  }
  signal?.throwIfAborted()
  return bytes
}

export async function loadDataset (file: string, points: number, links: number, signal?: AbortSignal): Promise<GraphDataset> {
  return decodeDataset(await loadDatasetBytes(file, signal), points, links)
}
