import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, appendFile, access } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const groups = {
  arithmetic: ['src/gpu', ...['neighborhood-forces', 'weighted-links', 'many-body', 'many-body-grid', 'combined-layout',
    'matched-layout', 'collision', 'repulsion-trajectories', 'precision-diagnostics'].map(name => `src/experiments/${name}`)],
  'point-styling': ['src/experiments/point-styling'],
  links: ['src/experiments/straight-links', 'src/experiments/curved-links', 'src/experiments/ribbon-generation'],
  full: [],
}
export function selection (investigation, sweep) {
  if (!Object.hasOwn(groups, investigation)) throw new Error('Unknown investigation')
  if (!['true', 'false'].includes(String(sweep))) throw new Error('Sweep must be true or false')
  const enabled = String(sweep) === 'true'
  const has = group => enabled && (investigation === group || investigation === 'full')
  return {
    investigation, sweep: enabled,
    filters: investigation === 'full' ? [] : [...groups[investigation], 'src/gpu/environment.test.ts'],
    flags: {
      LAB_STORED_ALPHA_SWEEP: has('point-styling') ? '1' : '0',
      LAB_RIBBON_COST: has('links') ? '1' : '0',
      LAB_FAR_ARITHMETIC_COST: has('arithmetic') ? '1' : '0',
      LAB_NATIVE_GPU: '0', LAB_INLINE_BROWSER: '0', LAB_SCALE_COUNT: '0', LAB_SCALE_PRECISION: 'products',
    },
    scope: 'Linux software reproduction only. Full means all configured files, not all native/scale opt-ins.',
    excluded: ['Native-only tests (LAB_NATIVE_GPU=0)', '8192/32768 production-layout sweeps (LAB_SCALE_COUNT=0)',
      ...(!enabled ? ['Explicit stored-alpha, ribbon and far-arithmetic cost sweeps'] :
        (has('point-styling') ? ['Original stored-alpha cost sweep still requires native mode; filtered paired sweep runs on software'] : []))],
  }
}
export function verifyPrSource (pr, repository) {
  if (pr.head?.repo?.full_name !== repository) {
    throw new Error('Manual investigations accept same-repository branches only; fork code must not run in the dispatch cache scope')
  }
}
export function verifyMergeParents (parents, base, head) {
  if (parents.trim().split(/\s+/).join(' ') !== `${base} ${head}`) throw new Error('Merge revision does not match the current PR base and head; retry after GitHub refreshes it')
}
const exec = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options }).trim()
async function resolveRevision () {
  const number = process.env.LAB_PR_NUMBER ?? ''; const repository = process.env.GITHUB_REPOSITORY
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid repository')
  let data
  if (number) {
    if (!/^[1-9]\d*$/.test(number)) throw new Error('PR number must be a positive integer')
    const pr = JSON.parse(exec('gh', ['api', `repos/${repository}/pulls/${number}`]))
    verifyPrSource(pr, repository)
    if (pr.state !== 'open' || pr.mergeable !== true) throw new Error('PR must be open and mergeable; no head-only fallback')
    const base = JSON.parse(exec('gh', ['api', `repos/${repository}/git/ref/heads/${encodeURIComponent(pr.base.ref)}`])).object.sha
    exec('git', ['fetch', '--no-tags', '--depth=2', 'origin', `refs/pull/${number}/merge`])
    const sha = exec('git', ['rev-parse', 'FETCH_HEAD'])
    verifyMergeParents(exec('git', ['show', '-s', '--format=%P', sha]), base, pr.head.sha)
    data = { source: 'pr-merge', repository, pr: Number(number), sha, base, reportedBase: pr.base.sha, head: pr.head.sha, baseRef: pr.base.ref }
  } else data = { source: 'dispatch-ref', repository, sha: exec('git', ['rev-parse', 'HEAD']) }
  const pkg = JSON.parse(exec('git', ['show', `${data.sha}:package.json`]))
  const nodeFloor = pkg.engines?.node?.match(/\d+/)?.[0]
  if (!nodeFloor) throw new Error('Selected revision has no Node floor')
  data.nodeFloor = nodeFloor
  await writeFile(process.env.LAB_REVISION_FILE, JSON.stringify(data, null, 2))
  await appendFile(process.env.GITHUB_OUTPUT, `sha=${data.sha}\nnode_floor=${nodeFloor}\n`)
  console.log(JSON.stringify(data, null, 2))
}
async function run () {
  const plan = selection(process.env.LAB_INVESTIGATION ?? 'point-styling', process.env.LAB_FULL_SWEEP ?? 'false')
  const root = resolve('experiments/cosmos-gpu-lab')
  try { await access(resolve(root, 'vitest.config.ts')) } catch {
    throw new Error('Selected revision does not contain the lab; select a PR merge or revision that includes it')
  }
  const runId = `validation-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
  const output = resolve(root, 'captures', runId)
  await mkdir(output, { recursive: true })
  const env = { ...process.env, ...plan.flags, LAB_ARTIFACT_RUN: runId }
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const version = args => exec(pnpm, args, { cwd: root, env })
  const manifest = {
    ...plan, startedAt: new Date().toISOString(), sha: exec('git', ['rev-parse', 'HEAD']),
    revision: process.env.LAB_REVISION_FILE ? JSON.parse(await readFile(process.env.LAB_REVISION_FILE, 'utf8')) : null,
    node: process.version, pnpm: version(['--version']), platform: process.platform, arch: process.arch,
    packages: JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).dependencies,
    lockHash: exec('git', ['hash-object', 'pnpm-lock.yaml']),
  }
  if (manifest.revision && manifest.revision.sha !== manifest.sha) throw new Error('Checked-out SHA differs from resolved revision')
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify(manifest, null, 2))
  version(['exec', 'vitest', 'list', '--config', 'vitest.config.ts', '--filesOnly', `--json=${resolve(output, 'selected-files.json')}`, ...plan.filters])
  const files = JSON.parse(await readFile(resolve(output, 'selected-files.json'), 'utf8'))
  if (!files.length) throw new Error('Selection contains no tests')
  console.log(`Selected ${files.length} files. Artifacts: ${relative(process.cwd(), output)}`)
  const log = createWriteStream(resolve(output, 'console.log'))
  const child = spawn(pnpm, ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', ...plan.filters,
    '--reporter=default', '--reporter=json', `--outputFile.json=${resolve(output, 'results.json')}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { process.stdout.write(chunk); log.write(chunk) })
  const code = await new Promise((yes, no) => { child.on('error', no); child.on('close', (code, signal) => yes(code ?? (signal ? 1 : 0))) })
  await new Promise(yes => log.end(yes))
  let outcome
  try {
    const report = JSON.parse(await readFile(resolve(output, 'results.json'), 'utf8'))
    outcome = { passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests,
      skippedTests: report.testResults.flatMap(file => file.assertionResults.filter(test => ['pending', 'skipped', 'todo'].includes(test.status))
        .map(test => ({ file: file.name, test: test.fullName, status: test.status }))) }
  } catch (error) { outcome = { incompleteReport: String(error) } }
  await writeFile(resolve(output, 'outcome.json'), JSON.stringify({ finishedAt: new Date().toISOString(), exitCode: code, ...outcome }, null, 2))
  console.log(JSON.stringify(outcome, null, 2))
  process.exitCode = code || (outcome.incompleteReport ? 1 : 0)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2]
  try {
    if (action === 'resolve') await resolveRevision()
    else if (action === 'run') await run()
    else throw new Error('Use resolve or run')
  } catch (error) { console.error(error); process.exitCode = 1 }
}
