
import GLBench from 'gl-bench'
import { benchCSS } from './css'

export class FPSMonitor {
  private bench: GLBench | undefined
  private container: HTMLElement

  public constructor (canvas: HTMLCanvasElement, container?: HTMLElement) {
    // Scope the widget (and the style element gl-bench injects) to the graph
    // container so multiple Graph instances don't remove each other's monitor.
    this.container = container ?? document.body
    this.destroy()
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGL2RenderingContext
    this.bench = new GLBench(gl, { css: benchCSS, dom: this.container })
  }

  public begin (): void {
    this.bench?.begin('frame')
  }

  public end (now: number): void {
    this.bench?.end('frame')
    this.bench?.nextFrame(now)
  }

  public destroy (): void {
    this.bench = undefined
    this.container.querySelector('#gl-bench')?.remove()
    this.container.querySelector('#gl-bench-style')?.remove()
  }
}
