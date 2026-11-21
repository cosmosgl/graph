import { createFixture } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'

export const youtubeFixtureHash = '1b4f834c6acf374905934cc4fd65ded5ef8116fd73016db5e15ee8177da0f8b5'

// Include the prepared fixture when building the Lab and allow other demos to
// build on a checkout where the dataset has yet to be prepared.
const prepared = import.meta.glob<string>('../../../captures/fixtures/youtube-million.bin', {
  eager: true, import: 'default', query: '?url',
})
const fixtureUrl = prepared['../../../captures/fixtures/youtube-million.bin'] ?? './captures/fixtures/youtube-million.bin'

function inducedLinks (endpoints: Uint32Array, count: number): Float32Array {
  const links = new Float32Array(endpoints.length)
  let used = 0
  for (let i = 0; i < endpoints.length; i += 2) {
    if (endpoints[i] >= count || endpoints[i + 1] >= count) continue
    links[used++] = endpoints[i]; links[used++] = endpoints[i + 1]
  }
  return links.subarray(0, used)
}

function sparseLinks (endpoints: Uint32Array, pointCount: number, count: number): Float32Array {
  const links = new Float32Array(count * 2)
  const ids = new Uint32Array(pointCount)
  const edgeCount = endpoints.length / 2
  // A stride coprime with this fixture's edge count visits every edge once,
  // spreading the sample across the source order.
  const stride = 131071
  let known = 0
  let used = 0
  for (let visited = 0, edge = 0; visited < edgeCount && used < links.length; visited++, edge = (edge + stride) % edgeCount) {
    const from = endpoints[edge * 2]
    const to = endpoints[edge * 2 + 1]
    const newPoints = Number(ids[from] === 0) + Number(to !== from && ids[to] === 0)
    // Reach the point budget first, then fill the link budget with retained accounts.
    if (known + newPoints > count || (newPoints === 0 && known < count)) continue
    if (ids[from] === 0) ids[from] = ++known
    if (ids[to] === 0) ids[to] = ++known
    links[used++] = ids[from] - 1
    links[used++] = ids[to] - 1
  }
  if (known !== count || used !== links.length) throw new Error('Could not sample the requested YouTube graph size')
  return links
}

export async function loadYoutubeFixture (count = 1000000, signal?: AbortSignal, topology: 'induced' | 'sparse' = 'induced'): Promise<{
  input: ReturnType<typeof createFixture>;
  graph: GraphInput;
}> {
  const response = await fetch(fixtureUrl, { signal })
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Prepare the SNAP YouTube fixture using the Lab README.')
  }
  const bytes = await response.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  signal?.throwIfAborted()
  const checksum = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  if (checksum !== youtubeFixtureHash) throw new Error('Unexpected SNAP YouTube fixture checksum')
  const data = new Uint32Array(bytes)
  const [pointCount, linkCount] = data
  if (pointCount !== 1000000 || linkCount !== 2852734 || data.length !== 2 + pointCount + linkCount * 2 || count > pointCount) {
    throw new Error('Invalid YouTube fixture dimensions')
  }
  const endpoints = data.subarray(2 + pointCount)
  const links = topology === 'sparse' ? sparseLinks(endpoints, pointCount, count) : inducedLinks(endpoints, count)
  const input = createFixture('uniform', count)
  return {
    input,
    graph: {
      points: input.points,
      links,
      weights: new Float32Array(links.length / 2).fill(1),
      sizes: new Float32Array(count).fill(2),
    },
  }
}
