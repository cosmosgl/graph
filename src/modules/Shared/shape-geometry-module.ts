import type { ShaderModule } from '@luma.gl/shadertools'

/**
 * Shared GLSL for the point shapes' geometry: the sizes each shape is drawn at in the sprite's
 * -1..1 core, and `shapeInradius(shape)`, the depth of a shape's deepest interior point as a
 * fraction of the sprite radius. The fragment stage's distance functions draw with these
 * constants and the vertex stage caps the stroke by the inradius, so the two cannot drift apart.
 * Attach via a Model's `modules`; the code is valid in both stages.
 */
const shapeGeometryGLSL = /* glsl */ `
const float SQUARE_HALF_SIZE = 0.8;
const float TRIANGLE_HALF_EDGE = 0.9;
const float DIAMOND_HALF_WIDTH = 0.8;
const float DIAMOND_ASPECT = 1.2;        // > 1: taller than wide
const float PENTAGON_APOTHEM = 0.726542528;
const float HEXAGON_APOTHEM = 0.8;
const float STAR_OUTER_RADIUS = 0.9;
const float STAR_INNER_RATIO = 0.45;     // inner / outer radius
const float CROSS_HALF_LENGTH = 0.8;
const float CROSS_HALF_THICKNESS = 0.3;

// The stroke band takes at most this fraction of a shape's depth, so a point is never more
// than half stroke: a small point keeps a narrower band and its fill rather than losing the
// stroke, and nothing switches on or off while zooming.
const float STROKE_MAX_DEPTH = 0.5;

// Depth of a shape's deepest interior point, as a fraction of the sprite radius: how far the
// centre of the fill sits from the nearest edge (a circle's centre is a full radius in; a cross
// arm is only its half-thickness). Shape ids as in the PointShape enum.
float shapeInradius(float shape) {
  if (shape == 1.0) return SQUARE_HALF_SIZE;
  else if (shape == 2.0) return TRIANGLE_HALF_EDGE / sqrt(3.0);     // equilateral: inradius = edge / (2 sqrt 3)
  else if (shape == 3.0) return DIAMOND_HALF_WIDTH * DIAMOND_ASPECT / sqrt(DIAMOND_ASPECT * DIAMOND_ASPECT + 1.0);
  else if (shape == 4.0) return PENTAGON_APOTHEM;
  else if (shape == 5.0) return HEXAGON_APOTHEM;
  else if (shape == 6.0) return STAR_OUTER_RADIUS * STAR_INNER_RATIO;   // the inner vertices
  else if (shape == 7.0) return CROSS_HALF_THICKNESS;
  else return 1.0;                                                        // circle
}
`

export const shapeGeometryModule: ShaderModule = {
  name: 'shapeGeometry',
  vs: shapeGeometryGLSL,
  fs: shapeGeometryGLSL,
}
