export type ResidentCamera = { x: number; y: number; zoom: number }
export type ResidentViewport = { width: number; height: number; pixelRatio: number }
export type ResidentClick = { x: number; y: number; started: number; trusted: boolean }

export function cameraFromView (view: Float32Array, height: number): ResidentCamera {
  const [x, y, side] = view
  if (!(side > 0)) throw new Error('Resident camera is not fitted')
  return { x: x + side * 0.5, y: y + side * 0.5, zoom: height / (side * 1.1) }
}

export function panCamera (camera: ResidentCamera, dx: number, dy: number): ResidentCamera {
  return { ...camera, x: camera.x - dx / camera.zoom, y: camera.y + dy / camera.zoom }
}

export function zoomCamera (
  camera: ResidentCamera, viewport: ResidentViewport, factor: number, x: number, y: number
): ResidentCamera {
  const zoom = Math.max(0.001, Math.min(256, camera.zoom * factor))
  const shift = 1 / camera.zoom - 1 / zoom
  return { x: camera.x + (x - viewport.width / 2) * shift, y: camera.y - (y - viewport.height / 2) * shift, zoom }
}

export function observeCanvasNavigation (surface: HTMLElement, viewport: ResidentViewport, actions: {
  pan(dx: number, dy: number): void;
  zoom(factor: number, x: number, y: number): boolean;
  pick?(click: ResidentClick): void;
}): () => void {
  const events = new AbortController()
  const { signal } = events
  let gesture: { id: number; x: number; y: number; dragging: boolean } | undefined
  const local = (event: MouseEvent): [number, number] => {
    const box = surface.getBoundingClientRect()
    return [(event.clientX - box.left) * viewport.width / box.width, (event.clientY - box.top) * viewport.height / box.height]
  }
  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture) return
    const [x, y] = local(event)
    gesture = { id: event.pointerId, x, y, dragging: false }
    if (event.isTrusted) surface.setPointerCapture(event.pointerId)
  }, { signal })
  surface.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return
    const [x, y] = local(event)
    const dx = x - gesture.x; const dy = y - gesture.y
    if (!gesture.dragging && Math.hypot(dx, dy) < 3) return
    actions.pan(dx, dy)
    gesture = { id: event.pointerId, x, y, dragging: true }
  }, { signal })
  surface.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return
    if (!gesture.dragging && actions.pick) {
      const [x, y] = local(event)
      actions.pick({ x, y, started: performance.now(), trusted: event.isTrusted })
    }
    gesture = undefined
  }, { signal })
  const clearGesture = (event: PointerEvent): void => { if (gesture?.id === event.pointerId) gesture = undefined }
  surface.addEventListener('pointercancel', clearGesture, { signal })
  surface.addEventListener('lostpointercapture', clearGesture, { signal })
  surface.addEventListener('wheel', event => {
    const [x, y] = local(event)
    const factor = Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.0025)
    if (actions.zoom(factor, x, y)) event.preventDefault()
  }, { signal, passive: false })
  return () => events.abort()
}
