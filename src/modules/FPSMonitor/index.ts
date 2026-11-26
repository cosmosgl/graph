
// gl-bench's `browser` entry is an export-less script, so a bare `gl-bench`
// specifier yields no default export in bundlers that honor that field. The
// ES entry is imported by path: gl-bench stays external, the consumer's
// bundler resolves this specifier, and no `browser` field redirects a path.
import GLBench from 'gl-bench/dist/gl-bench.module.js'
import { benchCSS } from './css'

export class FPSMonitor {
  private bench: GLBench | undefined
  private readonly widget: HTMLElement
  private readonly style: HTMLStyleElement

  /** A null canvas uses gl-bench's CPU and frame-rate measurements without opening a GL context. */
  public constructor (canvas: HTMLCanvasElement | null, container: HTMLElement = document.body) {
    // gl-bench creates fixed IDs. Capture the two nodes before mounting so a
    // graph can release only its own monitor, even when hosts are shared.
    const mount = container.ownerDocument.createElement('div')
    const gl = canvas && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    this.bench = new GLBench(gl, { css: benchCSS, dom: mount })
    this.widget = mount.querySelector<HTMLElement>('#gl-bench')!
    this.style = mount.querySelector<HTMLStyleElement>('#gl-bench-style')!
    if (!canvas) {
      this.bench.addUI('frame')
      this.widget.title = 'Frame rate and CPU frame load. GPU time is unavailable in this monitor.'
      this.widget.querySelector<HTMLElement>('.gl-box')!.style.cursor = 'default'
      // The built-in click toggles a WebGL-only profiler. Leave its GPU gauge hidden.
      this.widget.addEventListener('click', event => event.stopImmediatePropagation(), { capture: true })
    }
    container.append(this.style, this.widget)
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
    this.widget.remove()
    this.style.remove()
  }
}
