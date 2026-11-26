import { Layer } from '@deck.gl/core'
import { ClipSpace } from '@luma.gl/engine'

// Deck 10 alpha.1 implements view.clear by opening another pass while the
// view's pass is active. WebGPU requires this viewport-local fill to be drawn
// in the open pass. The main graph can then show through only outside the view.
export const thumbnailView = {}

class ThumbnailBackground extends Layer {
  public static override layerName = 'ThumbnailBackground'
  public declare state: { model: ClipSpace }

  public initializeState (): void {
    this.setState({
      model: new ClipSpace(this.context.device, {
        id: this.id,
        geometryType: 'triangle',
        source: `@fragment fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4f {
          return vec4f(25.0, 33.0, 50.0, 255.0) / 255.0;
        }`,
      }),
    })
  }

  public draw (): void { this.state.model.draw(this.context.renderPass) }
}

export function thumbnailBackground (id: string): Layer {
  return new ThumbnailBackground({ id, parameters: { depthCompare: 'always', depthWriteEnabled: false, blend: false } })
}
