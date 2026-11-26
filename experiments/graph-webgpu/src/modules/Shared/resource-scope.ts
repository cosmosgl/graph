type Resource = { destroy(): void }

/** Own resources at one lifetime and release them in reverse construction order. */
export function resourceScope (): { own<T extends Resource>(resource: T): T; destroy(): void } {
  const resources: Resource[] = []
  let destroyed = false
  return {
    own<T extends Resource> (resource: T): T {
      if (destroyed) {
        resource.destroy()
        throw new Error('Resource scope destroyed')
      }
      resources.push(resource)
      return resource
    },
    destroy (): void {
      if (destroyed) return
      destroyed = true
      let error: unknown
      for (const resource of resources.reverse()) {
        try { resource.destroy() } catch (e) { error ??= e }
      }
      resources.length = 0
      if (error) throw error
    },
  }
}
