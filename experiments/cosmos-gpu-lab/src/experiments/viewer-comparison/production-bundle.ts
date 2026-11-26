import type { Graph, GraphSimulation } from '../../../../../dist/index.js'

type CosmosPackage = Pick<typeof import('../../../../../dist/index.js'), 'Graph' | 'GraphSimulation'>
type StandaloneWindow = Window & Partial<Record<'Cosmos', CosmosPackage>>

// Optional at Lab build time: other experiments can run before either package has been built.
const bundles = import.meta.glob<string>([
  '../../../../../dist/index.min.js',
  '../../../../graph-webgpu/dist/index.min.js',
], { query: '?url', eager: true, import: 'default' })

async function loadPackage (engine: 'webgl' | 'webgpu', frame: Document, bundleUrl?: string): Promise<CosmosPackage> {
  const production = engine === 'webgl'
  const url = bundleUrl ?? bundles[production ? '../../../../../dist/index.min.js' : '../../../../graph-webgpu/dist/index.min.js']
  const command = production ? 'pnpm run build' : 'pnpm --filter @cosmos.gl/graph-webgpu build'
  if (!url) throw new Error(`Build the ${engine} package with ${command}, then restart or rebuild the Lab.`)
  await new Promise<void>((resolve, reject) => {
    const script = frame.createElement('script')
    script.src = new URL(url, document.baseURI).href
    script.onload = (): void => resolve()
    script.onerror = (): void => reject(new Error(`Could not load the ${engine} package from ${url}`))
    frame.head.append(script)
  })
  const cosmos = (frame.defaultView as StandaloneWindow).Cosmos
  if (!cosmos) throw new Error(`The ${engine} package did not expose Cosmos`)
  return cosmos
}

export async function loadGraphPackage (engine: 'webgl' | 'webgpu', frame: Document = document, bundleUrl?: string): Promise<typeof Graph> {
  const cosmos = await loadPackage(engine, frame, bundleUrl)
  if (!cosmos.Graph) throw new Error(`The ${engine} package did not expose a Graph constructor`)
  return cosmos.Graph
}

export async function loadGraphSimulationPackage (engine: 'webgl' | 'webgpu', frame: Document): Promise<typeof GraphSimulation> {
  const cosmos = await loadPackage(engine, frame)
  if (!cosmos.GraphSimulation) throw new Error(`The ${engine} package did not expose a GraphSimulation constructor`)
  return cosmos.GraphSimulation
}

// Keep the standalone production luma v9 bundle out of the Lab's v10 dependency graph.
export const loadProductionBundle = (): Promise<typeof Graph> => loadGraphPackage('webgl')
