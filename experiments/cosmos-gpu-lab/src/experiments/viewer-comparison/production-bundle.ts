import type { Graph } from '../../../../../dist/index.js'

type StandaloneWindow = Window & Partial<Record<'Cosmos', Pick<typeof import('../../../../../dist/index.js'), 'Graph'>>>

// Optional at Lab build time: other experiments can run before either package has been built.
const bundles = import.meta.glob<string>([
  '../../../../../dist/index.min.js',
  '../../../../graph-webgpu/dist/index.min.js',
], { query: '?url', eager: true, import: 'default' })

export async function loadGraphPackage (engine: 'webgl' | 'webgpu', frame: Document = document): Promise<typeof Graph> {
  const production = engine === 'webgl'
  const url = bundles[production ? '../../../../../dist/index.min.js' : '../../../../graph-webgpu/dist/index.min.js']
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
  if (!cosmos?.Graph) throw new Error(`The ${engine} package did not expose a Graph constructor`)
  return cosmos.Graph
}

// Keep the standalone production luma v9 bundle out of the Lab's v10 dependency graph.
export const loadProductionBundle = (): Promise<typeof Graph> => loadGraphPackage('webgl')
