import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build } from 'vite'

const lab = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(lab, '../..')
const counts = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [65536, 1000000]
const boxes = [
  [[115, 54], [846, 487]], [[421, 221], [499, 292]],
  [[92, 137], [316, 434]], [[847, 475], [665, 202]],
]
await mkdir(resolve(lab, 'captures'), { recursive: true })
const capture = await mkdtemp(resolve(lab, 'captures/public-graph-youtube-'))
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const candidate = resolve(root, 'experiments/graph-webgpu/dist/index.min.js')
await copyFile(candidate, resolve(capture, 'index.min.js'))
const paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root })
execFileSync('tar', ['-czf', resolve(capture, 'source.tar.gz'), '--null', '-T', '-'], { cwd: root, input: paths })
const result = {
  cpu: cpus()[0]?.model,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  snapshotSha256: await hash(resolve(capture, 'source.tar.gz')), bundleSha256: await hash(candidate),
  fixtureSha256: await hash(resolve(lab, 'captures/fixtures/youtube-million.bin')),
  lumaVersion: JSON.parse(await readFile(resolve(lab, 'node_modules/@luma.gl/core/package.json'))).version,
  boxes, counts, runs: [],
}
const save = () => writeFile(resolve(capture, 'result.json'), JSON.stringify(result, null, 2) + '\n')
await save()
console.log(capture)
// Freeze the replay, the standalone package and the fixture before bringing Chrome forward.
const site = resolve(capture, 'site')
await build({
  configFile: false, root: lab, base: './',
  build: { outDir: site, assetsInlineLimit: 0, rollupOptions: {
    input: resolve(lab, 'src/experiments/production-graph-api/youtube-check.ts'),
    preserveEntrySignatures: 'strict', output: { entryFileNames: 'public-youtube.js' },
  } },
})
const bundledFiles = await readdir(resolve(site, 'assets'))
const hashes = await Promise.all(bundledFiles.filter(file => file.endsWith('.js')).map(file => hash(resolve(site, 'assets', file))))
assert.ok(hashes.includes(result.bundleSha256), 'Candidate changed during snapshot capture; rebuild and replay')
await writeFile(resolve(site, 'index.html'), (await readFile(resolve(lab, 'migration-benchmark.html'), 'utf8'))
  .replace(/<script type="module".*?<\/script>/, ''))
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const path = resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!path.startsWith(site + '/')) { res.writeHead(403).end(); return }
    const data = await readFile(path)
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.html') ? 'text/html' : 'application/octet-stream')
    res.end(data)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ channel: 'chrome', headless: false })
try {
  result.browser = browser.version()
  for (const count of counts) {
    for (const mode of ['timing', 'correctness']) {
      const page = await browser.newPage({ viewport: { width: 1050, height: 680 }, deviceScaleFactor: 2 })
      const run = { count, mode, samples: [], errors: [] }
      result.runs.push(run)
      page.on('pageerror', err => run.errors.push(err.message))
      try {
        await page.goto(origin)
        await page.bringToFront()
        await page.evaluate(async ({ count, mode }) => {
          const { openYoutubeCheck } = await import('/public-youtube.js')
          document.querySelector('#stage').textContent = `WebGPU Graph · ${count.toLocaleString()} points`
          window.publicYoutube = await openYoutubeCheck(count)
          window.publicYoutube.verify(mode === 'correctness')
        }, { count, mode })
        Object.assign(run, await page.evaluate(() => ({ device: window.publicYoutube.info, links: window.publicYoutube.links })))
        assert.equal(run.device.type, 'webgpu')
        assert.equal(run.device.gpuArchitecture?.includes('swiftshader') || run.device.fallback === true, false)
        await page.waitForFunction(() => window.publicYoutube.tick >= 4, null, { timeout: 60000 })
        const bounds = await page.locator('#surface').boundingBox()
        assert.deepEqual([bounds.width, bounds.height], [961, 541])
        for (const [from, to] of boxes) {
          await page.mouse.move(bounds.x + from[0], bounds.y + from[1])
          await page.mouse.down()
          await page.mouse.move(bounds.x + to[0], bounds.y + to[1], { steps: 4 })
          await page.mouse.up()
          const sample = await page.evaluate(() => Promise.race([
            window.publicYoutube.result(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('No selection within 30 seconds')), 30000)),
          ]))
          run.samples.push(sample)
          await save()
          console.log(count, mode, JSON.stringify(sample))
          assert.ok(sample && sample.trusted && sample.visible && sample.ordered)
          assert.ok(Math.abs(sample.center[0] - bounds.width / 2) < 0.01 && Math.abs(sample.center[1] - bounds.height / 2) < 0.01)
          assert.ok(sample.labels === 1000 && sample.tickAtRelease >= 4)
          assert.equal(sample.verified, mode === 'correctness')
        }
        await page.locator('#surface').screenshot({ path: resolve(capture, `${count}-${mode}.png`), timeout: 20000 })
        assert.ok(run.samples.every(s => s.extra === 0 && s.missing === 0 && s.wrongLabels === 0))
        assert.ok(run.samples.some(s => s.selected > 0))
      } catch (error) {
        run.errors.push(String(error))
        console.error(count, mode, String(error))
      } finally {
        await page.close()
        await save()
      }
    }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await save() }
if (result.runs.some(run => run.errors.length)) process.exitCode = 1
