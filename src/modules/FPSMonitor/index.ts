
// gl-bench's `browser` entry is an export-less script, so a bare `gl-bench`
// specifier yields no default export in bundlers that honor that field. The
// ES entry is imported by path: gl-bench stays external, the consumer's
// bundler resolves this specifier, and no `browser` field redirects a path.
import GLBench from 'gl-bench/dist/gl-bench.module.js'
import { benchCSS } from './css'

export class FPSMonitor {
  private bench: GLBench | undefined
  private container: HTMLElement

  public constructor (canvas: HTMLCanvasElement, container?: HTMLElement) {
    // Scope the widget (and the style element gl-bench injects) to the graph's
    // container, so multiple Graph instances don't remove each other's monitor.
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
    // gl-bench appends both elements as direct children of the container;
    // ':scope >' keeps a monitor in a nested container out of reach.
    this.container.querySelector(':scope > #gl-bench')?.remove()
    this.container.querySelector(':scope > #gl-bench-style')?.remove()
  }
}
