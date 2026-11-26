import type { Graph } from '@cosmos.gl/graph'

export type SceneDevice = { gl: WebGL2RenderingContext; gpu?: undefined } | { gpu: GPUDevice; gl?: undefined }

/** Inspect the device already chosen by the installed Graph package. */
export function sceneDevice (graph: Graph, canvas: HTMLCanvasElement): SceneDevice {
  const handle = graph.simulation.device?.handle
  if (typeof GPUDevice !== 'undefined' && handle instanceof GPUDevice) return { gpu: handle }
  const gl = canvas.getContext('webgl2')
  if (!gl || gl.isContextLost()) throw new Error('The GPU could not open the full graph.')
  return { gl }
}

interface PositionSource {
  getPointPositionTexture?: () => { pointCount: number; textureSize: number } | undefined;
  getPointPositionBuffer?: () => { pointCount: number } | undefined;
}

export function uploadedPositions (graph: PositionSource): { pointCount: number; textureSize?: number } | undefined {
  return graph.getPointPositionTexture?.() ?? graph.getPointPositionBuffer?.()
}

export interface DrawFence {
  completed(): boolean;
  release?(): void;
}

/** A fence belongs to the exact queue that rendered the graph. */
export function afterDraw ({ gl, gpu }: SceneDevice): DrawFence {
  if (gl) {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    if (!sync) throw new Error('The GPU could not create a completion fence.')
    gl.flush()
    return {
      completed (): boolean {
        const state = gl.clientWaitSync(sync, 0, 0)
        if (state === gl.WAIT_FAILED || gl.isContextLost()) throw new Error('The GPU could not complete this frame.')
        return state === gl.CONDITION_SATISFIED || state === gl.ALREADY_SIGNALED
      },
      release: (): void => { gl.deleteSync(sync) },
    }
  }
  let done = false
  let error: Error | undefined
  gpu.queue.onSubmittedWorkDone().then(() => { done = true }, reason => { error = new Error(String(reason)) })
  return {
    completed (): boolean {
      if (error) throw error
      return done
    },
  }
}
