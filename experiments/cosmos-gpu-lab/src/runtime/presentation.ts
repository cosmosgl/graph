import { graphPalette } from './palette'

export function setStatus (element: HTMLElement, message: string, failed = false): void {
  element.textContent = message
  element.classList.toggle('failed', failed)
}

// Match the GPU markers: a 5 px square for pins, a 5 px disc for free points.
export function drawPoint (ctx: CanvasRenderingContext2D, x: number, y: number, pinned: boolean): void {
  ctx.fillStyle = pinned ? graphPalette.pinned : graphPalette.point
  if (pinned) ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
  else {
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill()
  }
}
