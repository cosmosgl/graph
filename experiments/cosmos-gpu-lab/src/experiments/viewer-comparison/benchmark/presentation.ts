export type Presentation = { frame: number; tick: number; time: number }

// Observe GPU-finished canvas frames at a browser presentation opportunity.
// The observer never drives either graph's animation loop or waits in it.
export function observePresentation (health: () => void): {
  readonly frames: Presentation[];
  readonly submittedCount: number;
  submitted(tick: number, ready?: () => boolean): void;
  after(frame: number, timeout?: number): Promise<Presentation>;
  destroy(): void;
} {
  const queue: { frame: number; tick: number; ready: () => boolean }[] = []
  const frames: Presentation[] = []
  let submittedCount = 0
  let request = 0
  let failure: unknown
  let disposed = false
  function observe (time: number): void {
    try {
      health()
      let latest: typeof queue[number] | undefined
      while (queue[0]?.ready()) latest = queue.shift()!
      if (latest) frames.push({ frame: latest.frame, tick: latest.tick, time })
      request = requestAnimationFrame(observe)
    } catch (error) { failure = error }
  }
  request = requestAnimationFrame(observe)
  return {
    frames,
    get submittedCount (): number { return submittedCount },
    submitted (tick, ready = (): boolean => true): void {
      if (!disposed) queue.push({ frame: ++submittedCount, tick, ready })
    },
    async after (frame, timeout = 20000): Promise<Presentation> {
      const deadline = performance.now() + timeout
      while (performance.now() < deadline) {
        if (disposed) throw new Error('The presentation observer was closed')
        if (failure) throw failure
        const latest = frames.at(-1)
        if (latest && latest.frame > frame) return latest
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      throw new Error(`No completed frame after submission ${frame} (${submittedCount} submitted, ${frames.length} observed)`)
    },
    destroy (): void {
      disposed = true
      cancelAnimationFrame(request)
      queue.length = 0
    },
  }
}

export type PresentationObserver = ReturnType<typeof observePresentation>
