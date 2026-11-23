import { defineExperiment } from '../../runtime/experiment'
import { renderResultChart } from '../../runtime/result-chart'
import { cases, karateFitChart } from './cases'
const graph = defineExperiment({
  id: 'integrated-webgpu',
  title: 'First integrated WebGPU graph',
  summary: 'Run a force layout, select and drag points, and explore how the graph responds as it moves.',
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  initialEvidence: 'first-recorded',
  howItWorks: {
    summary: 'The force simulation updates point positions on the GPU. Circles, straight links and point picking read those same positions. ' +
      '[Run the timing and pixel checks](#/integrated-webgpu-benchmarks).',
    relatedExperiments: ['integrated-webgpu-benchmarks'],
  },
  tags: ['integration', 'simulation', 'rendering', 'WebGPU'],
  cases,
  create: async host => (await import('./view')).createView(host),
  pages: [
    {
      kind: 'markdown',
      id: 'overview',
      title: 'Recorded evidence',
      load: async (): Promise<string> => (await import('./overview.md?raw')).default,
    },
    { kind: 'markdown', id: 'method', title: 'Scope and evaluation protocol', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    {
      kind: 'markdown',
      id: 'findings',
      title: 'Integrated findings',
      examples: { karateFit: (host): void => host.append(renderResultChart(karateFitChart)) },
      load: async (): Promise<string> => (await import('./findings.md?raw')).default,
    },
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

const benchmarks = defineExperiment({
  id: 'integrated-webgpu-benchmarks',
  title: 'Integrated WebGPU graph benchmarks',
  summary: 'Measure frame pacing, picking feedback and sampled rendering on the original graph workloads.',
  tags: ['performance', 'interaction', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  howItWorks: false,
  cases: [{
    id: 'measure',
    kind: 'measure',
    title: 'Measure the integrated graph',
    question: 'Which graphs meet the frame, picking and rendering targets on this device?',
    description: 'Run the core pilot on a single graph or the declared matrix.',
    reference: 'Original workloads, pixel reference and timing gates.',
    acceptance: 'Read each workload’s frame, interaction and sampled pixel results separately.',
    recorded: null,
    evidence: [{ label: 'Benchmark method and recorded results', page: 'protocol' }],
  }],
  create: async host => {
    const [view, tools] = await Promise.all([import('./view'), import('./benchmark-view')])
    return await view.createView(host, tools)
  },
  pages: [{
    kind: 'markdown',
    id: 'protocol',
    title: 'Measurement references',
    relatedExperiments: ['integrated-webgpu', 'viewer-comparison'],
    load: async (): Promise<string> => (await import('./benchmark-protocol.md?raw')).default,
  }],
})
export const experiments = [graph, benchmarks]
