export type GuardTarget = { prototype: object; method: string; deny: (args: unknown[]) => boolean }
export function installGpuRequestGuard (targets: GuardTarget[]): { assertUnused(): void; restore(): void } {
  const attempts: string[] = []; const restore: Array<() => void> = []
  for (const { prototype, method, deny } of targets) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
    if (!descriptor || typeof descriptor.value !== 'function') continue
    Object.defineProperty(prototype, method, {
      ...descriptor,
      value: function (...args: unknown[]): unknown {
        if (deny(args)) {
          attempts.push(method)
          throw new Error(`Automatic lab UI tests must not request a GPU: ${method}`)
        }
        return Reflect.apply(descriptor.value, this, args)
      },
    })
    restore.push(() => Object.defineProperty(prototype, method, descriptor))
  }
  return {
    assertUnused (): void {
      const used = attempts.splice(0)
      if (used.length) throw new Error(`GPU requests were attempted (including caught errors): ${used.join(', ')}`)
    },
    restore (): void { restore.reverse().forEach(fn => { fn() }) },
  }
}
export function browserGpuTargets (): GuardTarget[] {
  const targets: GuardTarget[] = [HTMLCanvasElement, ...(typeof OffscreenCanvas === 'undefined' ? [] : [OffscreenCanvas])]
    .map(ctor => ({
      prototype: ctor.prototype,
      method: 'getContext',
      deny: args =>
        ['webgl', 'webgl2', 'experimental-webgl', 'webgpu'].includes(String(args[0])),
    }))
  for (const [name, method] of [['GPU', 'requestAdapter'], ['GPUAdapter', 'requestDevice']]) {
    const ctor = Reflect.get(globalThis, name) as { prototype: object } | undefined
    if (ctor) targets.push({ prototype: ctor.prototype, method, deny: () => true })
  }
  return targets
}
