import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const { values } = parseArgs({ options: { bundles: { type: 'string' }, points: { type: 'string', default: '1000000' } } })
const count = Number(values.points)
assert.ok(Number.isSafeInteger(count) && count >= 1026 && count <= 1000000)
const lab = fileURLToPath(new URL('../', import.meta.url))
const root = join(lab, 'captures')
assert.ok(values.bundles, 'Provide --bundles <directory under captures>')
const dir = resolve(root, values.bundles)
assert.ok(dir.startsWith(root + sep))
const bytes = await readFile(join(dir, 'webgpu.js'))
const output = join(root, `pointer-pass-${new Date().toISOString().replace(/[.:]/g, '-')}`)
await mkdir(output)
const report = { bundles: values.bundles, sha256: createHash('sha256').update(bytes).digest('hex'), pointCount: count }
const server = await createServer({ root: lab, server: { host: '127.0.0.1', watch: null }, logLevel: 'error' })
let browser
const timer = setTimeout(() => browser?.close(), 150000)
try {
  await server.listen(0)
  browser = await chromium.launch({ channel: 'chrome', headless: false })
  const page = await browser.newPage({ viewport: { width: 1050, height: 680 }, deviceScaleFactor: 2 })
  await page.route('**/__profile_graph__.js', route => route.fulfill({ contentType: 'application/javascript', body: bytes }))
  await page.goto(server.resolvedUrls.local[0] + 'packaged-force-benchmark.html')
  await page.bringToFront()
  await page.addScriptTag({ url: '/__profile_graph__.js' })
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()) })
  page.on('pageerror', error => console.error(String(error)))
  report.browser = browser.version()
  report.fixture = await page.evaluate(async pointCount => {
    const { scaleFixture } = await import('/src/experiments/production-forces/scale-fixture.ts')
    const { loadForce, forceConfig } = await import('/src/experiments/production-forces/fixture.ts')
    // Opt in to pass timestamps without modifying the signed engine bundle.
    const createDevice = window.luma.createDevice.bind(window.luma)
    window.luma.createDevice = props => createDevice({
      ...props, optionalFeatures: [...(props.optionalFeatures ?? []), 'timestamp-query'],
    })
    const host = document.querySelector('#graph')
    const picks = []
    const picked = (id, xy, event) => picks.push({ id, xy, trusted: event.isTrusted, timestamp: event.timeStamp, callback: performance.now() })
    const graph = new Cosmos.Graph(host, {
      ...forceConfig('hubs'), pixelRatio: 2, enableRenderLoop: false,
      onPointClick: (id, xy, event) => picked('Point ' + id, xy, event),
      onLinkClick: (id, event) => picked('Link ' + id, undefined, event),
      onBackgroundClick: event => picked('Background', undefined, event),
    })
    await graph.ready
    const device = graph.simulation.device
    if (device.info.gpu !== 'apple' || device.info.fallback !== false || device.info.gpuType === 'cpu') throw new Error('Expected native Apple WebGPU')
    const fixture = scaleFixture('hubs', pointCount)
    loadForce(graph, 'hubs', { width: 961, height: 541 }, pointCount)
    // Every original inter-anchor edge joins two pins. Redirect the final one
    // between two existing pins, producing an isolated, independently known link.
    const links = fixture.links.slice()
    const widths = fixture.linkWidths.slice()
    const link = widths.length - 1
    const anchor = fixture.firstAnchor
    links.set([0, anchor], link * 2)
    widths[link] = 6
    graph.setLinks(links)
    graph.setLinkWidths(widths)
    graph.setPointRenderOrder([anchor])
    graph.render(1, 0)
    graph.unpause()
    const done = async () => {
      const f = device.createFence()
      try { await f.signaled } finally { f.destroy() }
    }
    for (let tick = 1; tick <= 58; tick++) {
      graph.renderOneFrame()
      if (tick % 4 === 0) await done()
    }
    graph.pause()
    await done()
    const pin = graph.spaceToScreenPosition([...fixture.positions.slice(0, 2)])
    const end = graph.spaceToScreenPosition([...fixture.positions.slice(anchor * 2, anchor * 2 + 2)])
    const targets = [
      { name: 'point', xy: pin, expected: 'Point 0' },
      { name: 'link', xy: pin.map((v, i) => Math.round(v + (end[i] - v) * 0.4)), expected: 'Link ' + link },
      { name: 'background', xy: [12, 12], expected: 'Background' },
      { name: 'crowded point', xy: end, expected: 'Point ' + anchor },
    ]
    if (!device.features.has('timestamp-query')) throw new Error('Requires timestamp-query on the profiling device')
    const times = device.createQuerySet({ type: 'timestamp', count: 4 })
    let active
    const beginRender = device.beginRenderPass.bind(device)
    device.beginRenderPass = props => {
      if (!active) return beginRender(props)
      active.passes++
      const pass = beginRender({ ...props, timestampQuerySet: times, beginTimestampIndex: 0, endTimestampIndex: 1 })
      for (const name of ['draw', 'drawIndirect']) {
        const draw = pass[name].bind(pass)
        pass[name] = (...args) => {
          const part = active.draws++ === 0 ? 'link' : 'point'
          if (active.mode !== 'both' && active.mode !== part) return false
          return draw(...args)
        }
      }
      return pass
    }
    const beginCompute = device.beginComputePass.bind(device)
    device.beginComputePass = props => {
      if (!active) return beginCompute(props)
      active.computePasses++
      return beginCompute({ ...props, timestampQuerySet: times, beginTimestampIndex: 2, endTimestampIndex: 3 })
    }
    async function sample(mode, target) {
      await done()
      const row = { mode, target: target.name, draws: 0, passes: 0, computePasses: 0 }
      active = row
      const start = performance.now()
      let hit
      try { hit = await graph.renderer.pick(...target.xy, graph.view()) } finally { active = undefined }
      row.wall = performance.now() - start
      if (row.draws !== 2 || row.passes !== 1) throw new Error('Unexpected packaged pick geometry: ' + JSON.stringify(row))
      if (row.computePasses > 1) throw new Error('Expected at most one range computation')
      const stamp = await times.readResults({ firstQuery: 0, queryCount: row.computePasses ? 4 : 2 })
      row.renderGpu = Number(stamp[1] - stamp[0]) / 1e6
      row.computeGpu = row.computePasses ? Number(stamp[3] - stamp[2]) / 1e6 : 0
      row.gpu = row.renderGpu + row.computeGpu
      row.id = hit ? (hit.kind === 'point' ? 'Point ' : 'Link ') + hit.index : 'Background'
      if (mode === 'both' && row.id !== target.expected) throw new Error('Unexpected packaged hit: ' + JSON.stringify(row))
      return row
    }
    window.measurePicks = async () => {
      const modes = ['both', 'point', 'link', 'empty']
      const samples = []
      for (let round = 0; round < 8; round++) {
        for (let i = 0; i < targets.length; i++) {
          for (let j = 0; j < modes.length; j++) {
            const row = await sample(modes[(j + round) % modes.length], targets[(i + round) % targets.length])
            if (round >= 2) samples.push(row)
          }
        }
      }
      return samples
    }
    window.checkedPicks = picks
    window.closePicks = () => {
      times.destroy()
      graph.destroy()
    }
    return { targets, origin: [host.offsetLeft, host.offsetTop], adapter: device.info, features: [...device.features], luma: window.luma.VERSION, link, anchor }
  }, count)
  for (const target of report.fixture.targets) {
    const [x, y] = target.xy.map((v, i) => v + report.fixture.origin[i])
    await page.mouse.click(x, y)
    await page.waitForFunction(id => window.checkedPicks.at(-1)?.id === id, target.expected, { timeout: 3000 })
  }
  report.clicks = await page.evaluate(() => window.checkedPicks)
  assert.ok(report.clicks.every(pick => pick.trusted))
  report.samples = await page.evaluate(() => window.measurePicks())
  await page.evaluate(() => window.closePicks())
  report.medians = {}
  for (const { name } of report.fixture.targets) {
    const modes = {}
    for (const mode of ['both', 'point', 'link', 'empty']) {
      const samples = report.samples.filter(row => row.target === name && row.mode === mode)
      modes[mode] = Object.fromEntries(['computeGpu', 'renderGpu', 'gpu', 'wall'].map(metric => {
        const values = samples.map(row => row[metric]).sort((a, b) => a - b)
        return [metric, (values[2] + values[3]) / 2]
      }))
    }
    report.medians[name] = modes
    console.log(name, modes)
  }
} catch (error) {
  report.error = String(error)
  process.exitCode = 1
  console.error(error)
} finally {
  clearTimeout(timer)
  await browser?.close()
  await server.close()
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(output)
}
