import type { Graph } from '../../../../../dist/index.js'
import controlUrl from '../../../../../dist/index.min.js?url'

// Keep the standalone production luma v9 bundle out of the Lab's v10 dependency graph.
export async function loadProductionBundle (): Promise<typeof Graph> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = controlUrl
    script.onload = (): void => resolve()
    script.onerror = (): void => reject(new Error('Build the workspace production UMD control before running this comparison'))
    document.head.append(script)
  })
  return (window as unknown as Record<string, Record<string, typeof Graph>>).Cosmos.Graph
}
