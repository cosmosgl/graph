import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')

export async function captureBenchmarkSource(repo, lab, capture) {
  const git = args => execFileSync('git', args, { cwd: repo })
  const archive = join(capture, 'source.tar.gz')
  // Keep edits and untracked build inputs, including paths containing newlines.
  const deleted = new Set(git(['ls-files', '-z', '--deleted']).toString('latin1').split('\0'))
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'])
    .toString('latin1').split('\0').filter(path => path && !deleted.has(path))
  execFileSync('tar', ['-czf', archive, '--null', '-T', '-'], {
    cwd: repo, input: Buffer.from(`${files.join('\0')}\0`, 'latin1'),
  })
  const version = async root => JSON.parse(await readFile(join(root, 'node_modules/@luma.gl/core/package.json'), 'utf8')).version
  return {
    revision: git(['rev-parse', 'HEAD']).toString().trim(),
    status: git(['status', '--porcelain']).toString(),
    snapshot: relative(repo, archive),
    snapshotSha256: await sha256(archive),
    productionSha256: await sha256(join(repo, 'dist/index.min.js')),
    workspaceLuma: { webgl: await version(repo), lab: await version(lab), webgpu: await version(join(repo, 'experiments/graph-webgpu')) },
  }
}
