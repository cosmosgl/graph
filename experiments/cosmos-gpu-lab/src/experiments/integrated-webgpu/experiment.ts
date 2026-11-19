import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'integrated-webgpu',
  title: 'First integrated WebGPU graph',
  summary: 'One resident graph with core forces, circle points, straight links and interaction; assess the bounded first-migration slice.',
  tags: ['integration', 'simulation', 'rendering', 'WebGPU'],
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Scope and evaluation protocol', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Integrated findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
    {
      kind: 'markdown',
      id: 'host-ownership',
      title: 'Shared WebGPU device and recovery',
      load: async (): Promise<string> => (await import('./host-ownership.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'selection',
      title: 'Rectangle and polygon selection',
      load: async (): Promise<string> => (await import('../selection/findings.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'tracked-points',
      title: 'Tracked point readback',
      load: async (): Promise<string> => (await import('./tracked-points.md?raw')).default,
    },
  ],
})
