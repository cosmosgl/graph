import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'point-buffer-copy',
  title: 'CPU copy vs GPU copy',
  summary: 'Compare copying point positions through the CPU and directly on the GPU when WebGPU rebuilds its buffers.',
  tags: ['simulation', 'resources', 'WebGPU'],
  cases: [{
    id: 'copy-during-rebuild',
    title: 'Copy existing point positions into new buffers',
    kind: 'compare',
    question: 'What changes when WebGPU copies point positions on the GPU during a rebuild?',
    description: 'Both previews allocate new buffers at each point count. One copies the positions that stay through the CPU. ' +
      'The other copies them directly between GPU buffers.',
    tryIt: 'Press Add and remove points to compare how much position data each preview downloads and how long each full rebuild takes.',
    reference: 'The CPU copy path, the expected point data after the rebuild, and an optional CPU check for the following frame.',
    acceptance: 'Both previews keep their devices and preserve the positions, pinning and visibility of the points that stay. ' +
      'New points get their expected starting data and the next frame must agree across both previews.',
    recorded: {
      conclusion: 'Both paths kept the positions of the points that stayed. GPU copying avoided position downloads during the update. ' +
        'Its full buffer rebuild took longer in the recorded runs.',
      date: '11 November 2026',
      environment: 'Apple M3, standalone Chrome 156.',
      scope: 'Chain, communities and star, with point counts from 2,048 to 8,192 and both paths rebuilding their buffers.',
      limits: 'The timings cover full rebuilds with different CPU and GPU bounds setup. The CPU copy path always ran first.',
      evidence: [{ label: 'Copy and rebuild results', page: 'findings' }],
    },
  }],
  create: async host => (await import('./view')).createBufferCopyView(host),
  pages: [{
    kind: 'markdown',
    id: 'findings',
    title: 'Copy and rebuild results',
    relatedExperiments: ['point-capacity', 'resident-frame-timing'],
    load: async (): Promise<string> => (await import('./findings.md?raw')).default,
  }],
})
