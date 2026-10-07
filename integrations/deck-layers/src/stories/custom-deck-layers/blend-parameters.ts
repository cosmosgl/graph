/**
 * Premultiplied-style alpha blending with depth writes disabled: points and
 * links are drawn back-to-front by layer order, never by depth.
 *
 * Wire through `defaultProps.parameters`: before every draw, deck resets each
 * model's pipeline parameters from `layer.props.parameters`. Parameters given
 * only at `Model` creation last one frame.
 *
 * Declare the default with `compare: 2`, like the base layer does — a plain
 * object default would drop deep comparison, and every new-but-equal
 * `parameters` object from the caller would count as a prop change.
 */
export const BLEND_PARAMETERS = {
  depthWriteEnabled: false,
  depthCompare: 'always',
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const
