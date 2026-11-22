import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'point-buffer-copy',
  title: 'CPU copy vs GPU copy',
  summary: 'Compare copying point positions through the CPU and directly on the GPU when WebGPU rebuilds its buffers.',
  tags: ['simulation', 'resources', 'WebGPU'],
  showRecordedSummary: false,
  howItWorks: {
    summary: 'Both previews rebuild their buffers to fit 8,192 points. The CPU path downloads the existing positions and uploads them again ' +
      'with the new points. The GPU path copies the existing positions between buffers and uploads only the new points. ' +
      'Total rebuild time includes allocation, setup and transfers through GPU completion. The previews also set up layout bounds differently.',
  },
  cases: [{
    id: 'copy-during-rebuild',
    title: 'Copy existing point positions into new buffers',
    kind: 'compare',
    question: 'Can WebGPU keep existing point positions on the GPU when the graph grows?',
    description: 'Both previews allocate new buffers at each point count. One copies the positions that stay through the CPU. ' +
      'The other copies them directly between GPU buffers.',
    reference: 'The CPU copy path downloads the existing position records before it uploads the expanded array.',
    acceptance: 'Compare the bytes downloaded for existing positions during the same chain growth in both previews.',
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
