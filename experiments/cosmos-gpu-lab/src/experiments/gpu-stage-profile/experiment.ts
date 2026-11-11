import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'gpu-stage-profile',
  title: 'Controlled GPU stage profiling',
  summary: 'Replay one frozen graph through normal and split-pass timing; compare rebuilt and retained resources under unchanged checks.',
  tags: ['benchmark', 'simulation', 'WebGPU'],
  create: async host => (await import('./view')).createProfileView(host),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }],
})
