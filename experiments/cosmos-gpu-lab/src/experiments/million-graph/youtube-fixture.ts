import { createFixture } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'

export const youtubeFixtureHash = '1b4f834c6acf374905934cc4fd65ded5ef8116fd73016db5e15ee8177da0f8b5'

export async function loadYoutubeFixture (count = 1000000): Promise<{
  input: ReturnType<typeof createFixture>;
  graph: GraphInput;
}> {
  const response = await fetch('/captures/fixtures/youtube-million.bin')
  if (!response.ok) throw new Error('Prepare the SNAP YouTube fixture before running the replay')
  const bytes = await response.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const checksum = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  if (checksum !== youtubeFixtureHash) throw new Error('Unexpected SNAP YouTube fixture checksum')
  const data = new Uint32Array(bytes)
  const [pointCount, linkCount] = data
  if (pointCount !== 1000000 || linkCount !== 2852734 || data.length !== 2 + pointCount + linkCount * 2 || count > pointCount) {
    throw new Error('Invalid YouTube fixture dimensions')
  }
  const endpoints = data.subarray(2 + pointCount)
  const links = new Float32Array(endpoints.length)
  let used = 0
  for (let i = 0; i < endpoints.length; i += 2) {
    if (endpoints[i] >= count || endpoints[i + 1] >= count) continue
    links[used++] = endpoints[i]; links[used++] = endpoints[i + 1]
  }
  const input = createFixture('uniform', count)
  return {
    input,
    graph: {
      points: input.points,
      links: links.subarray(0, used),
      weights: new Float32Array(used / 2).fill(1),
      sizes: new Float32Array(count).fill(2),
    },
  }
}
