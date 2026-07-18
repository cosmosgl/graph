import { computePca } from './pca'

/**
 * Web Worker that runs the client-side PCA off the main thread, so the ~15–25s
 * of covariance + projection doesn't freeze the tab. Receives the raw int8
 * embeddings (transferred in, zero-copy), streams progress back, and returns the
 * reduced int8 embeddings + 2D init (transferred out).
 */

// Dedicated worker global scope; typed as Worker (same postMessage/onmessage
// surface) to avoid pulling in the WebWorker lib.
const ctx: Worker = self as unknown as Worker

type Request = { emb: ArrayBuffer; n: number; dim: number; outDim: number }

ctx.onmessage = async (event: MessageEvent): Promise<void> => {
  const { emb, n, dim, outDim } = event.data as Request
  const result = await computePca(new Int8Array(emb), n, dim, outDim, (phase, fraction) => {
    ctx.postMessage({ type: 'progress', phase, fraction })
  })
  ctx.postMessage(
    { type: 'done', reduced: result.reduced.buffer, init2d: result.init2d.buffer },
    [result.reduced.buffer, result.init2d.buffer]
  )
}
