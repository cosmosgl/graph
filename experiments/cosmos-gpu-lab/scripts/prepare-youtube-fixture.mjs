import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'

const files = new URL('../captures/fixtures/', import.meta.url)
const original = await readFile(new URL('com-youtube.ungraph.txt.gz', files))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceSha256 = hash(original)
if (sourceSha256 !== 'dff1b97ba7d2fa9c59884b67dcd2275e717ff9501f86ed82ce6582ed4971f3e0') {
  throw new Error('The SNAP source archive has changed')
}

async function* edges () {
  const lines = createInterface({ input: Readable.from([original]).pipe(createGunzip()), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.startsWith('#') || !line) continue
    yield line.split('\t').map(Number)
  }
}

const degrees = new Map()
let sourceLinks = 0
for await (const [from, to] of edges()) {
  degrees.set(from, (degrees.get(from) ?? 0) + 1)
  degrees.set(to, (degrees.get(to) ?? 0) + 1)
  sourceLinks++
}
if (degrees.size !== 1134890 || sourceLinks !== 2987624) throw new Error('Unexpected SNAP graph size')

// Preserve the hubs and the original edge order. Compact IDs are assigned in
// original ID order, and the fixture retains both ID spaces.
const pointCount = 1000000
const retained = [...degrees.keys()].sort((a, b) => degrees.get(b) - degrees.get(a) || a - b)
  .slice(0, pointCount).sort((a, b) => a - b)
const indices = new Map(retained.map((id, i) => [id, i]))
const fromDegree = new Uint32Array(pointCount)
const toDegree = new Uint32Array(pointCount)
// Little-endian u32: point count, link count, original IDs, then compact link pairs.
const bytes = Buffer.alloc(4 * (2 + pointCount + sourceLinks * 2))
bytes.writeUInt32LE(pointCount, 0)
retained.forEach((id, i) => bytes.writeUInt32LE(id, 4 * (2 + i)))
let offset = 4 * (2 + pointCount)
let linkCount = 0
for await (const [from, to] of edges()) {
  const source = indices.get(from)
  const target = indices.get(to)
  if (source === undefined || target === undefined) continue
  bytes.writeUInt32LE(source, offset)
  bytes.writeUInt32LE(target, offset + 4)
  offset += 8
  fromDegree[source]++
  toDegree[target]++
  linkCount++
}
bytes.writeUInt32LE(linkCount, 4)
const fixture = bytes.subarray(0, offset)

const totalDegree = i => fromDegree[i] + toDegree[i]
const hubIndices = [...indices.values()].sort((a, b) => totalDegree(b) - totalDegree(a) || a - b).slice(0, 5)
const hubs = hubIndices.map(i => ({ id: retained[i], index: i, degree: totalDegree(i), from: fromDegree[i], to: toDegree[i] }))
const metadata = { sourceSha256, fixtureSha256: hash(fixture), pointCount, linkCount, hubs }
await writeFile(new URL('youtube-million.bin', files), fixture)
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
