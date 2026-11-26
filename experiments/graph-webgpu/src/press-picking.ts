import { select, type Selection } from 'd3-selection'
import type { Hovered } from '../../../src/modules/Store'

type Node = Selection<HTMLCanvasElement, undefined, null, undefined>
type Press = MouseEvent | TouchEvent
type Listener = (this: HTMLCanvasElement, event: Press, datum: undefined) => void

interface PressOptions {
  signal: AbortSignal;
  canDrag: (event: Press) => boolean;
  /** undefined means background. null means the device or dataset changed while resolving. */
  pick: (clientX: number, clientY: number) => Promise<Hovered | undefined | null>;
  setSubject: (point: Hovered) => void;
  onError: (error: unknown) => void;
}

interface Pending {
  down: Press;
  move?: Press;
}

/** D3 chooses its gesture synchronously. Hold only the initiating press until its own GPU pick
 * resolves, then feed D3 the original press and the newest movement. Its normal gesture listeners
 * own all later events, including click suppression, touch gestures and zoom lifecycle callbacks. */
export function bindPressPicking (node: Node, options: PressOptions): () => boolean {
  const canvas = node.node()!
  const win = canvas.ownerDocument.defaultView!
  const windowNode = select(win)
  const mouseDrag: Listener | undefined = node.on('mousedown.drag')
  const mouseZoom: Listener | undefined = node.on('mousedown.zoom')
  const touchDrag: Listener | undefined = node.on('touchstart.drag')
  const touchZoom: Listener | undefined = node.on('touchstart.zoom')
  let pending: Pending | undefined
  let pendingEvents: AbortController | undefined
  let activeMouseEnd: ((this: typeof win, e: MouseEvent, datum: undefined) => void) | undefined

  function clearPending (): void {
    pendingEvents?.abort()
    pendingEvents = undefined
    pending = undefined
  }

  function cancel (): void {
    clearPending()
    if (!activeMouseEnd) return
    // Only end the window gesture this canvas installed. A different canvas can take it over.
    if (windowNode.on('mouseup.drag') === activeMouseEnd || windowNode.on('mouseup.zoom') === activeMouseEnd) {
      activeMouseEnd.call(win, new MouseEvent('mouseup', { view: win }), undefined)
    }
    activeMouseEnd = undefined
  }
  options.signal.addEventListener('abort', cancel, { once: true })
  win.addEventListener('blur', cancel, { signal: options.signal })
  win.addEventListener('mouseup', () => { activeMouseEnd = undefined }, { capture: true, signal: options.signal })

  function begin (event: Press): void {
    const touch = 'touches' in event
    const drag = touch ? touchDrag : mouseDrag
    const zoom = touch ? touchZoom : mouseZoom
    clearPending()
    if (!drag || !options.canDrag(event) || (touch && event.touches.length !== 1)) {
      const earlier = windowNode.on('mouseup.zoom')
      zoom?.call(canvas, event, undefined)
      const end = windowNode.on('mouseup.zoom')
      if (!touch && end !== earlier) activeMouseEnd = end
      return
    }
    const location = touch ? event.touches[0] : event
    if (!location) return
    const press: Pending = { down: event }
    pending = press
    // Listen outside the canvas only while this press is awaiting readback.
    pendingEvents = new AbortController()
    const listeners = { capture: true, signal: pendingEvents.signal }
    const move = (e: Press): void => { press.move = e }
    if (touch) {
      win.addEventListener('touchmove', move, listeners)
      win.addEventListener('touchend', clearPending, listeners)
      win.addEventListener('touchcancel', clearPending, listeners)
    } else {
      win.addEventListener('mousemove', move, listeners)
      win.addEventListener('mouseup', clearPending, listeners)
    }
    options.pick(location.clientX, location.clientY).then(point => {
      if (pending !== press) return
      clearPending()
      if (point === null || options.signal.aborted) return
      const kind = point ? 'drag' : 'zoom'
      if (point) options.setSubject(point)
      const start = point ? drag : zoom
      start?.call(canvas, press.down, undefined)
      if (!touch) activeMouseEnd = windowNode.on(`mouseup.${kind}`)
      if (press.move) {
        if (touch) node.on(`touchmove.${kind}`)?.call(canvas, press.move, undefined)
        else windowNode.on(`mousemove.${kind}`)?.call(win, press.move, undefined)
      }
    }).catch(error => {
      if (pending === press) clearPending()
      options.onError(error)
    })
  }

  node.on('mousedown.drag mousedown.zoom', null).on('mousedown.webgpu', begin)
  if (touchDrag || touchZoom) node.on('touchstart.drag touchstart.zoom', null).on('touchstart.webgpu', begin)
  options.signal.addEventListener('abort', () => { node.on('.webgpu', null) }, { once: true })
  return () => !!pending
}
