export class SharedStore {
  public screenSize: [number, number] = [0, 0]
  public maxPointSize: number = 64
  public canvas: HTMLCanvasElement

  public constructor (canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  public updateScreenSize (width: number, height: number): void {
    this.screenSize = [width, height]
  }
}
