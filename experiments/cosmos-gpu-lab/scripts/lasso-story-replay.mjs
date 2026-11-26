// Run both development Storybooks, then invoke this script from the repository root.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { captureBenchmarkSource, sha256 } from './benchmark-source.mjs'
import { expectedLassoMeshHash, installLassoFixture, installLassoPackage, lassoForceSeed } from './lasso-story-fixture.mjs'

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'webgl-bundle': { type: 'string' }, 'webgpu-bundle': { type: 'string' },
  'before-webgpu': { type: 'string' }, 'exact-before': { type: 'boolean' },
} })
assert.ok(positionals.length <= 2, 'Expected at most two positional URLs, WebGL then WebGPU')
assert.ok(!values['exact-before'] || values['before-webgpu'], '--exact-before requires --before-webgpu')
const [reference = 'http://127.0.0.1:6006', candidate = 'http://127.0.0.1:6007'] = positionals
const lab = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const capture = join(lab, 'captures', `lasso-story-${new Date().toISOString().replace(/[.:]/g, '-')}`)
const ticks = [1, 10, 60, 240, 241, 242, 243, 244, 245, 246, 247, 248]
const captureTicks = [1, 60, 240]
const points = 22500
const clusters = 25
const viewport = { width: 680, height: 536 }
await mkdir(capture, { recursive: true })
console.log(capture)
const source = await captureBenchmarkSource(repo, lab, capture)

async function freezeBundle(path, name) {
  if (!path) return undefined
  const file = join(capture, name + '.js')
  await copyFile(resolve(path), file)
  return { file, sha256: await sha256(file) }
}
const referenceBundle = await freezeBundle(values['webgl-bundle'], 'webgl')
const beforeBundle = await freezeBundle(values['before-webgpu'], 'before')
const candidateBundle = await freezeBundle(values['webgpu-bundle'], 'webgpu')

async function replay(browser, base, engine, label = engine, bundle) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  try {
    await installLassoFixture(page)
    if (bundle) await installLassoPackage(page, bundle)
    await page.addInitScript(() => {
      window.lassoReplay = { tick: 0, target: 1 }
      window.prepareLassoProps = props => ({
        ...props,
        onSimulationTick(...args) {
          props.onSimulationTick?.(...args)
          if (++window.lassoReplay.tick === window.lassoReplay.target) window.lassoFixture.graph.pause()
        },
      })
    })
    await page.goto(new URL('/iframe.html?id=examples-interaction--lasso-selection&viewMode=story', base).href)
    assert.equal(await page.locator('#cosmos-preview-build').getAttribute('data-engine'), engine)
    const positions = new Map()
    let initialHash
    let adapter
    let clusterIds
    for (const tick of ticks) {
      if (tick > 1) {
        await page.evaluate(target => { window.lassoReplay.target = target; window.lassoFixture.graph.unpause() }, tick)
      }
      await page.waitForFunction(n => window.lassoReplay?.tick >= n, tick, { timeout: 120000 })
      if (errors.length) throw new Error(errors[0])
      const sample = await page.evaluate(async tick => {
        const { graph, initial, clusters } = window.lassoFixture
        const xy = await graph.getPointPositionsAsync()
        return {
          tick: window.lassoReplay.tick, zoom: graph.getZoomLevel(), seed: graph.config.randomSeed,
          initial: tick === 1 ? Array.from(initial) : undefined,
          clusters: tick === 1 ? Array.from(clusters) : undefined,
          adapter: tick === 1 ? graph.simulation.device.info : undefined,
          frozenPackage: tick === 1 && graph.constructor === window.Cosmos?.Graph,
          xy: Array.from(xy), center: graph.spaceToScreenPosition([2048, 2048]),
        }
      }, tick)
      assert.equal(sample.tick, tick)
      assert.equal(sample.zoom, 0.4)
      assert.deepEqual(sample.center, [viewport.width / 2, viewport.height / 2])
      assert.equal(sample.seed, lassoForceSeed)
      assert.equal(sample.xy.length, points * 2)
      assert.ok(sample.xy.every(Number.isFinite))
      if (sample.initial) {
        if (bundle) assert.equal(sample.frozenPackage, true, 'Story should use the specified frozen Graph')
        clusterIds = sample.clusters
        assert.equal(clusterIds.length, points)
        assert.equal(new Set(clusterIds).size, clusters)
        adapter = sample.adapter
        assert.equal(adapter.type, engine.toLowerCase())
        assert.notEqual(adapter.gpuType, 'cpu')
        if (engine === 'WebGPU') assert.equal(adapter.fallback, false)
        const initial = new Float32Array(sample.initial)
        initialHash = positionHash(initial)
        positions.set(0, initial)
      }
      positions.set(tick, new Float32Array(sample.xy))
      if (captureTicks.includes(tick)) {
        await page.locator('#storybook-root canvas').first().screenshot({ path: join(capture, `${label}-${tick}.png`) })
      }
    }
    assert.deepEqual(errors, [])
    return { initialHash, positions, clusterIds, adapter }
  } finally { await page.close() }
}

function radius90(xy) {
  let centerX = 0, centerY = 0
  for (let i = 0; i < xy.length; i += 2) { centerX += xy[i]; centerY += xy[i + 1] }
  const radii = new Float64Array(points)
  for (let id = 0; id < points; id++) radii[id] = Math.hypot(xy[2 * id] - centerX / points, xy[2 * id + 1] - centerY / points)
  return radii.sort()[Math.floor(points * 0.9)]
}

function positionDifference(a, b) {
  let squares = 0
  for (let i = 0; i < a.length; i++) squares += (a[i] - b[i]) ** 2
  return Math.sqrt(squares / points)
}

function positionHash(xy) {
  return createHash('sha256').update(new Uint8Array(xy.buffer, xy.byteOffset, xy.byteLength)).digest('hex')
}

function differingIds(a, b) {
  const before = new Uint32Array(a.buffer, a.byteOffset, a.length)
  const after = new Uint32Array(b.buffer, b.byteOffset, b.length)
  const ids = []
  for (let i = 0; i < before.length; i += 2) {
    if (before[i] !== after[i] || before[i + 1] !== after[i + 1]) ids.push(i / 2)
  }
  return ids
}

// Remove each color group's translation, then measure its members' RMS movement.
function internalMotion(previous, current, clusterIds) {
  const shifts = new Float64Array(2 * clusters)
  const members = new Uint32Array(clusters)
  for (let id = 0; id < points; id++) {
    const group = clusterIds[id]
    members[group]++
    shifts[2 * group] += current[2 * id] - previous[2 * id]
    shifts[2 * group + 1] += current[2 * id + 1] - previous[2 * id + 1]
  }
  let squares = 0
  for (let id = 0; id < points; id++) {
    const group = clusterIds[id]
    const dx = current[2 * id] - previous[2 * id] - shifts[2 * group] / members[group]
    const dy = current[2 * id + 1] - previous[2 * id + 1] - shifts[2 * group + 1] / members[group]
    squares += dx * dx + dy * dy
  }
  return Math.sqrt(squares / points)
}

const browser = await chromium.launch({ channel: 'chrome', headless: false })
try {
  const session = await browser.newBrowserCDPSession()
  const gpus = (await session.send('SystemInfo.getInfo')).gpu.devices.map(d => d.deviceString)
  const gl = await replay(browser, reference, 'WebGL', 'WebGL', referenceBundle)
  const before = beforeBundle && await replay(browser, candidate, 'WebGPU', 'WebGPU-before', beforeBundle)
  const gpu = await replay(browser, candidate, 'WebGPU', 'WebGPU', candidateBundle)
  for (const lane of [gpu, before].filter(Boolean)) {
    assert.equal(gl.initialHash, lane.initialHash)
    assert.deepEqual(gl.clusterIds, lane.clusterIds)
  }
  assert.equal(gl.initialHash, expectedLassoMeshHash, 'Replay the original 22,500-point mesh')
  const rows = [0, ...ticks].map(tick => {
    const a = gl.positions.get(tick), b = gpu.positions.get(tick)
    const previous = before?.positions.get(tick)
    return {
      tick, webglRadius90: radius90(a), webgpuRadius90: radius90(b), positionRmsDifference: positionDifference(a, b),
      positionSha256: { webgl: positionHash(a), webgpu: positionHash(b), ...(previous && { before: positionHash(previous) }) },
      ...(previous && { beforeRadius90: radius90(previous), beforeToCandidateRms: positionDifference(previous, b),
        differingIds: differingIds(previous, b) }),
      ...(tick > 240 && {
        webglInternalMotion: internalMotion(gl.positions.get(tick - 1), a, gl.clusterIds),
        webgpuInternalMotion: internalMotion(gpu.positions.get(tick - 1), b, gpu.clusterIds),
        ...(previous && { beforeInternalMotion: internalMotion(before.positions.get(tick - 1), previous, before.clusterIds) }),
      }),
    }
  })
  const motionRms = key => Math.sqrt(rows.slice(-8).reduce((sum, row) => sum + row[key] ** 2, 0) / 8)
  const report = { source, chrome: browser.version(), gpus, adapters: { webgl: gl.adapter, webgpu: gpu.adapter, before: before?.adapter },
    bundles: { webgl: referenceBundle, before: beforeBundle, webgpu: candidateBundle }, viewport, initialHash: gl.initialHash, rows,
    motion: { webgl: motionRms('webglInternalMotion'), webgpu: motionRms('webgpuInternalMotion'),
      ...(before && { before: motionRms('beforeInternalMotion') }) } }
  await writeFile(join(capture, 'results.json'), JSON.stringify(report, null, 2) + '\n')
  const labels = before ? ['WebGL', 'WebGPU-before', 'WebGPU'] : ['WebGL', 'WebGPU']
  const pairs = captureTicks.map(tick => `<tr><th>Tick ${tick}</th>${labels.map(engine =>
    `<td><img src="${engine}-${tick}.png" alt="${engine} layout at tick ${tick}"></td>`).join('')}</tr>`).join('\n')
  await writeFile(join(capture, 'comparison.html'), `<!doctype html><html lang="en"><meta charset="utf-8">
    <title>Lasso Selection on WebGL and WebGPU</title>
    <style>body{font:16px system-ui;margin:1rem}table{border-spacing:.5rem}img{width:min(${84/labels.length}vw,680px);display:block}</style>
    <table><caption>Lasso Selection · 22,500 points</caption><thead><tr><td></td>${labels.map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${pairs}</tbody></table></html>`)
  console.table(rows.filter(row => row.tick <= 240).map(({ positionSha256, differingIds, ...row }) => ({
    ...row, ...(differingIds && { differingPoints: differingIds.length }),
  })))
  console.log('RMS within-cluster motion, ticks 240–248', report.motion)
  if (values['exact-before']) {
    const difference = rows.find(row => row.differingIds.length)
    if (difference) assert.fail(`${difference.differingIds.length} point IDs differ from the frozen WebGPU control at tick ${difference.tick}`)
  }
  // At the story's 0.4 zoom, one CSS pixel corresponds to 2.5 graph units.
  const firstStep = rows.find(row => row.tick === 1)
  assert.ok(firstStep.positionRmsDifference * 0.4 < 1, 'First-step point positions differ by at least one CSS pixel RMS')
  for (const row of rows) {
    assert.ok(Math.abs(row.webgpuRadius90 - row.webglRadius90) * 0.4 < 1, `90% radius differs by at least one CSS pixel at tick ${row.tick}`)
  }
  assert.ok(Math.abs(report.motion.webgpu / report.motion.webgl - 1) < 0.05, 'Late within-cluster motion differs by 5% or more')
} finally { await browser.close() }
