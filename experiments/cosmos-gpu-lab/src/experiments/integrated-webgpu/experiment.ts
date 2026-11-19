import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'integrated-webgpu',
  title: 'First integrated WebGPU graph',
  summary: 'One resident graph with core forces, circle points, straight links and interaction; assess the bounded first-migration slice.',
  tags: ['integration', 'simulation', 'rendering', 'WebGPU'],
  cases,
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Scope and evaluation protocol', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Integrated findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
    {
      kind: 'markdown',
      id: 'composed-interaction',
      title: 'Interactive composed forces on M3',
      load: async (): Promise<string> => (await import('./composed-interaction.md?raw')).default,
    },
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
    {
      kind: 'markdown',
      id: 'readback',
      title: 'Selection and tracked labels',
      load: async (): Promise<string> => (await import('./readback.md?raw')).default,
    },
  ],
})
