
import { select } from 'd3-selection'
import GLBench from 'gl-bench'
import { benchCSS } from './css'

export class FPSMonitor {
  private bench: GLBench | undefined

  public constructor (canvas: HTMLCanvasElement) {
    this.destroy()
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGL2RenderingContext
    this.bench = new GLBench(gl, { css: benchCSS })
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
    select('#gl-bench').remove()
  }
}
