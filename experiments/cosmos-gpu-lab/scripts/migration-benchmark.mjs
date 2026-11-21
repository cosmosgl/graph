import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { calibrate, compare, formatComparison } from './migration-results.mjs'

const lab = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: {
  fixture: { type: 'string', default: 'karate' },
  points: { type: 'string' },
  smoke: { type: 'boolean' },
  'steady-only': { type: 'boolean' },
} })
const fixture = values.fixture
const steadyOnly = values['steady-only']
const points = values.points === undefined ? fixture === 'karate' ? 34 : 1000000 : Number(values.points)
if (!['karate', 'dense', 'hubs', 'youtube'].includes(fixture) || !Number.isInteger(points) ||
  (fixture === 'karate' ? points !== 34 : points < 1026 || points > 1000000)) throw new Error('Invalid workload or point count')
if (!cpus()[0]?.model.includes('Apple M3')) throw new Error('This benchmark requires the Apple M3 control machine')

const stamp = new Date().toISOString().replace(/[.:]/g, '-')
const scope = values.smoke ? 'smoke' : steadyOnly ? 'steady-only' : 'full'
const suffix = scope === 'full' ? '' : `-${scope}`
const capture = join(lab, 'captures', `migration-${fixture}-${points}-${stamp}${suffix}`)
await mkdir(capture, { recursive: true })
const git = args => execFileSync('git', args, { cwd: repo })
const archive = join(capture, 'source.tar.gz')
// Compare the NUL-delimited paths without losing bytes in filenames.
const deleted = new Set(git(['ls-files', '-z', '--deleted']).toString('latin1').split('\0'))
const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'])
  .toString('latin1').split('\0').filter(path => !deleted.has(path))
execFileSync('tar', ['-czf', archive, '--null', '-T', '-'], {
  cwd: repo, input: Buffer.from(`${files.join('\0')}\0`, 'latin1'),
})
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const version = async root => JSON.parse(await readFile(join(root, 'node_modules/@luma.gl/core/package.json'), 'utf8')).version
const source = {
  revision: git(['rev-parse', 'HEAD']).toString().trim(),
  snapshot: relative(repo, archive),
  snapshotSha256: await sha(archive),
  productionSha256: await sha(join(repo, 'dist/index.min.js')),
  luma: { webgl: await version(repo), webgpu: await version(lab) },
}
const save = async (name, data) => await writeFile(join(capture, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`)
await save('source', source)
console.log(`Capturing ${fixture} at ${points.toLocaleString()} points in ${relative(repo, capture)}`)

const server = await createServer({
  root: lab,
  optimizeDeps: { include: ['d3-selection', 'd3-zoom', '@interacta/css-labels', '@luma.gl/shaders'] },
  server: { host: '127.0.0.1', watch: null },
})
await server.listen(0)
const url = `http://127.0.0.1:${server.httpServer.address().port}/migration-benchmark.html`

async function deadline(task, ms, name) {
  let timer
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} exceeded ${ms / 1000}s`)), ms)
    })])
  } finally { clearTimeout(timer) }
}

async function run(backend, name) {
  const entry = { backend, name, scope, source, status: 'started', browser: '', stage: 'Chrome startup', diagnostics: [], result: null }
  let browser
  let page
  console.log(`Starting ${name} (${backend})`)
  const snapshot = () => deadline(page.evaluate(() => window.benchmark?.snapshot()), 4500, 'Capture of partial results')
  const call = async (stage, method, args = [], ms = 65000) => {
    entry.stage = stage
    return await deadline(page.evaluate(({ method, args }) => window.benchmark[method](...args), { method, args }), ms, stage)
  }
  const prepare = async () => {
    entry.stage = 'Fixture and modules'
    await page.goto(url, { timeout: 25000 })
    await page.waitForFunction(() => !!window.prepareBenchmark, null, { timeout: 25000 })
    await deadline(page.evaluate(({ backend, fixture, points }) => window.prepareBenchmark(backend, fixture, points), { backend, fixture, points }), 45000, entry.stage)
  }
  const screenshot = async (suffix) => {
    if (values.smoke || name.endsWith('control-2')) return
    try { await page.locator('#surface').screenshot({ path: join(capture, `${name}-${suffix}.png`), timeout: 10000 }) } catch (error) {
      entry.diagnostics.push(`${suffix} screenshot: ${String(error)}`)
    }
  }
  const log = message => { if (entry.diagnostics.length < 30) entry.diagnostics.push(message.slice(0, 800)) }
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false, timeout: 20000 })
    entry.browser = browser.version()
    page = await browser.newPage({ viewport: { width: 1050, height: 680 }, deviceScaleFactor: 2 })
    page.on('console', message => { if (message.type() === 'error') log(message.text()) })
    page.on('pageerror', error => log(String(error)))
    page.on('crash', () => log('Chrome renderer crashed'))
    await prepare()
    await call('Cold startup', 'open')
    const before = await snapshot()
    if (!/Apple/i.test(JSON.stringify(before.adapter))) throw new Error('The browser did not report an Apple GPU adapter')
    const bounds = await page.locator('#graph canvas').boundingBox()
    if (!bounds || bounds.width !== 961 || bounds.height !== 541 || bounds.x < 0 || bounds.y < 0 ||
      bounds.x + bounds.width > 1050 || bounds.y + bounds.height > 680) throw new Error('The full 961 × 541 study canvas is not visible')
    await screenshot('initial')
    await call('Steady moving graph', 'motion', values.smoke ? [3, 8] : [8, 48])
    console.log(`  ${name} steady p95 ${(await snapshot()).steady.p95.toFixed(1)} ms`)
    await screenshot('moving')
    if (!steadyOnly) {
      await call('Start pointer workflow', 'beginInteraction')
      const pointer = ([x, y]) => [bounds.x + x, bounds.y + y]
      await page.mouse.move(...pointer([15, 20]))
      await page.mouse.down()
      try { await page.mouse.move(...pointer([47, 39]), { steps: 3 }) } finally { await page.mouse.up() }
      await page.mouse.move(...pointer([480, 270]))
      await page.mouse.wheel(0, -100)
      await call('Pan and zoom', 'waitForFrames', [4])
      await call('Prepare known click targets', 'prepareClicks')
      for (let turn = 0; turn < (values.smoke ? 4 : 12); turn++) {
        const xy = pointer(await call(`Click target ${turn + 1}`, 'target', [turn], 20000))
        await page.mouse.move(...xy)
        await call('Same pointer dwell', 'waitForFrames', [2])
        await page.mouse.click(...xy)
        await call(`Click feedback ${turn + 1}`, 'waitForPick', [turn], 22000)
      }
      await call('Interaction frame window', 'endInteraction')
      await call('Moving selection and labels', 'readback', [values.smoke ? 2 : 8])
      await call('Updates, resize and stale selection', 'updates', [], 65000)
    }
    entry.result = await snapshot()
    await call('Release first graph', 'close')
    if (!steadyOnly) {
      await prepare()
      await call('Warm startup', 'open')
      entry.result.warmStartupMs = (await snapshot()).startupMs
      await call('Release second graph', 'close')
    }
    const failedReadbacks = entry.result.readbacks.filter(row => row.areaError || row.labelError)
    entry.status = failedReadbacks.length ? 'incomplete' : 'complete'
    entry.stage = failedReadbacks.length ? 'Moving selection and labels' : 'complete'
    if (failedReadbacks.length) console.log(`  ${name} returned incomplete selection or labels for ${failedReadbacks.length} request(s)`)
  } catch (error) {
    entry.status = 'failed'
    entry.error = String(error)
    if (page && !entry.result) entry.result = await snapshot().catch(() => null)
    console.log(`  ${name} stopped during ${entry.stage}. ${entry.error}`)
  } finally {
    try { await save(name, entry) } finally {
      if (browser) await deadline(browser.close(), 18000, 'Chrome shutdown').catch(error => console.log(String(error)))
    }
  }
  return entry
}

try {
  if (values.smoke) {
    for (const backend of ['webgl', 'webgpu']) {
      if ((await run(backend, backend)).status !== 'complete') process.exitCode = 1
    }
  } else {
    const controls = [await run('webgl', 'webgl-control-1'), await run('webgl', 'webgl-control-2')]
    const calibration = calibrate(controls)
    await save('calibration', calibration)
    console.log('Saved the WebGL A/A margins before opening WebGPU')
    const pairs = []
    if (controls.every(control => control.status === 'complete')) {
      pairs.push({ webgl: await run('webgl', 'pair-1-webgl'), webgpu: await run('webgpu', 'pair-1-webgpu') })
      const gpu = await run('webgpu', 'pair-2-webgpu')
      pairs.push({ webgl: await run('webgl', 'pair-2-webgl'), webgpu: gpu })
    } else {
      // Retain candidate capacity evidence even when the control failed.
      pairs.push({ webgl: controls.find(run => run.status === 'complete') ?? controls[0], webgpu: await run('webgpu', 'capacity-webgpu') })
    }
    const rows = compare(pairs, calibration).filter(row => !steadyOnly || row.label === 'Steady frame p95')
    await save('comparison', rows)
    await writeFile(join(capture, 'comparison.md'), `${formatComparison(rows)}\n`)
    console.log(formatComparison(rows))
  }
} finally { await server.close() }
