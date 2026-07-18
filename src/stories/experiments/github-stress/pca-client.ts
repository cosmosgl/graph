import type { PcaResult } from './pca'

/**
 * Main-thread wrapper that runs `computePca` in a Web Worker (see pca.worker.ts).
 * The raw embeddings buffer is transferred into the worker (zero-copy — the main
 * thread no longer needs it once reduced), and the results are transferred back.
 */

type ProgressMsg = { type: 'progress'; phase: string; fraction: number }
type DoneMsg = { type: 'done'; reduced: ArrayBuffer; init2d: ArrayBuffer }

export function runPca (
  emb: Int8Array,
  n: number,
  dim: number,
  outDim: number,
  onProgress?: (phase: string, fraction: number) => void
): Promise<PcaResult> {
  return new Promise<PcaResult>((resolve, reject) => {
    const worker = new Worker(new URL('./pca.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent): void => {
      const msg = event.data as ProgressMsg | DoneMsg
      if (msg.type === 'progress') {
        onProgress?.(msg.phase, msg.fraction)
      } else {
        resolve({ reduced: new Int8Array(msg.reduced), init2d: new Float32Array(msg.init2d) })
        worker.terminate()
      }
    }
    worker.onerror = (event: ErrorEvent): void => {
      reject(new Error(`PCA worker failed: ${event.message}`))
      worker.terminate()
    }
    const buffer = emb.buffer
    worker.postMessage({ emb: buffer, n, dim, outDim }, [buffer])
  })
}
