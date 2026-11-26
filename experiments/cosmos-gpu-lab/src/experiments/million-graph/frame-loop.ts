// On-demand animation with at most one frame in flight. The next normal
// animation request follows completion, including any asynchronous GPU work.
export function createResidentFrameLoop (options: {
  wantsFrame(): boolean;
  frame(time: number): Promise<void>;
  scheduleAhead?(): boolean;
  opportunity?(time: number, busy: boolean): void;
}): { request(): void; cancel(): void } {
  let requestId = 0
  let busy = false
  const request = (): void => {
    if (requestId || !options.wantsFrame() || (busy && !options.scheduleAhead?.())) return
    requestId = requestAnimationFrame(time => {
      requestId = 0
      options.opportunity?.(time, busy)
      if (!options.wantsFrame()) return
      if (busy) { request(); return }
      busy = true
      if (options.scheduleAhead?.()) request()
      options.frame(time).finally(() => { busy = false; request() })
    })
  }
  return {
    request,
    cancel (): void { cancelAnimationFrame(requestId); requestId = 0 },
  }
}
