import { Graph } from '@cosmos.gl/graph'
import type { StoryObj } from '@storybook/html'
import { CosmosStoryProps } from '@/graph/stories/create-cosmos'

export type Story = StoryObj<CosmosStoryProps & { graph: Graph; destroy?: () => void; _disposed?: boolean }>;

export const createStory: (storyFunction: () => {
  graph: Graph;
  div: HTMLDivElement;
  destroy?: () => void;
} | Promise<{
  graph: Graph;
  div: HTMLDivElement;
  destroy?: () => void;
}>) => Story = (storyFunction) => ({
  async beforeEach (d): Promise<() => void> {
    d.args._disposed = false
    return (): void => {
      // Teardown contract: the graph is destroyed here, once, for every story.
      // A story's `destroy` is only for cleanup beyond the graph itself
      // (timers, listeners, restored globals, external devices). A throwing
      // destroy must not skip the graph teardown that follows it.
      d.args._disposed = true
      try {
        d.args.destroy?.()
      } finally {
        d.args.graph?.destroy()
      }
    }
  },
  render: (args): HTMLDivElement => {
    const result = storyFunction()

    if (result instanceof Promise) {
      // For async story functions, create a simple div and update it when ready
      const div = document.createElement('div')
      div.style.height = '100vh'
      div.style.width = '100%'
      div.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">Loading story...</div>'

      result.then((story) => {
        // The story may resolve after its teardown already ran (switched away
        // while loading) — mounting then would leak a live graph into a
        // detached div. Dispose it immediately instead.
        if (args._disposed) {
          try {
            story.destroy?.()
          } finally {
            story.graph.destroy()
          }
          return
        }
        args.graph = story.graph
        args.destroy = story.destroy
        // Replace the content with the actual story div
        div.innerHTML = ''
        div.appendChild(story.div)
      }).catch((error) => {
        console.error('Failed to load story:', error)
        div.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ff0000;">Failed to load story</div>'
      })

      return div
    } else {
      // Synchronous story function
      args.graph = result.graph
      args.destroy = result.destroy
      return result.div
    }
  },
})
