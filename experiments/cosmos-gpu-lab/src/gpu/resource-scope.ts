import { Buffer } from '@luma.gl/core'
type Owned = { destroy(): void }
export class BufferLedger {
  public liveBytes = 0
  public peakBytes = 0
  public transactionPeakBytes = 0
  public liveBuffers = 0
  private buffers = new Set<Buffer>()
  public begin (): void { this.transactionPeakBytes = this.liveBytes }
  public add (buffer: Buffer): void {
    if (this.buffers.has(buffer)) throw new Error('Buffer has two owners')
    this.buffers.add(buffer); this.liveBytes += buffer.byteLength; this.liveBuffers++
    this.peakBytes = Math.max(this.peakBytes, this.liveBytes)
    this.transactionPeakBytes = Math.max(this.transactionPeakBytes, this.liveBytes)
  }

  public remove (buffer: Buffer): void {
    if (!this.buffers.delete(buffer)) throw new Error('Buffer released without ownership')
    this.liveBytes -= buffer.byteLength; this.liveBuffers--
  }
}
// Counts explicitly owned application buffers, not driver/pipeline/texture memory.
export function resourceScope (ledger?: BufferLedger): { own<T extends Owned>(resource: T): T; destroy(): void } {
  const resources: Owned[] = []; let destroyed = false
  return {
    own<T extends Owned> (resource: T): T {
      if (destroyed) { resource.destroy(); throw new Error('Resource scope destroyed') }
      if (ledger && resource instanceof Buffer) ledger.add(resource)
      resources.push(resource); return resource
    },
    destroy (): void {
      if (destroyed) return
      destroyed = true; let error: unknown
      for (const resource of resources.reverse()) {
        try { resource.destroy() } catch (e) { error ??= e } finally {
          if (ledger && resource instanceof Buffer) ledger.remove(resource)
        }
      }
      resources.length = 0
      if (error) throw error
    },
  }
}
