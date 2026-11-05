#version 300 es
#ifdef GL_ES
precision highp float;
precision highp int;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D polygonPathTexture; // Segment endpoints in XY and ZW
uniform sampler2D exitTexture;
uniform sampler2D pointSize;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform findPointsInPolygonUniforms {
  vec2 worldOrigin;
  vec2 screenSize;
  mat4 transformationMatrix;
  float polygonPathLength;
  float sizeScale;
  float ratio;
  float scalePointsOnZoom;
  float maxPointSize;
  vec2 polygonBounds0;
  vec2 polygonBounds1;
} findPointsInPolygon;

#define worldOrigin findPointsInPolygon.worldOrigin
#define screenSize findPointsInPolygon.screenSize
#define transformationMatrix findPointsInPolygon.transformationMatrix
#define polygonPathLength int(findPointsInPolygon.polygonPathLength)
#define sizeScale findPointsInPolygon.sizeScale
#define ratio findPointsInPolygon.ratio
#define scalePointsOnZoom findPointsInPolygon.scalePointsOnZoom
#define maxPointSize findPointsInPolygon.maxPointSize
#define polygonBounds0 findPointsInPolygon.polygonBounds0
#define polygonBounds1 findPointsInPolygon.polygonBounds1
#else
uniform vec2 polygonBounds0;
uniform vec2 polygonBounds1;
uniform float sizeScale;
uniform float ratio;
uniform float scalePointsOnZoom;
uniform float maxPointSize;
uniform int polygonPathLength;
uniform vec2 worldOrigin;
uniform vec2 screenSize;
uniform mat3 transformationMatrix;
#endif

out vec4 fragColor;

// Separating-axis test for a segment and an axis-aligned square.
// Includes endpoints, tangency and zero-length segments.
bool segmentTouchesSquare(vec2 a, vec2 b, vec2 center, float halfSize) {
  vec2 midpoint = 0.5 * (a + b) - center;
  vec2 halfEdge = 0.5 * (b - a);
  vec2 extent = abs(halfEdge);
  if (any(greaterThan(abs(midpoint), vec2(halfSize) + extent))) return false;
  return abs(midpoint.x * halfEdge.y - midpoint.y * halfEdge.x) <= halfSize * (extent.x + extent.y);
}

// Footprint overlap: edge intersection or centre containment by ray casting.
bool pointInPolygon(vec2 point, float radius, bool square, sampler2D pathTexture, int pathLength) {
  bool inside = false;
  int width = textureSize(pathTexture, 0).x;
  ivec2 texel = ivec2(0);

  for (int i = 0; i < pathLength; i++) {
    
    // Advance the row-major cursor without per-edge integer division/modulo.
    vec4 segment = texelFetch(pathTexture, texel, 0);
    texel.x++;
    if (texel.x == width) {
      texel.x = 0;
      texel.y++;
    }
    vec2 pi = segment.xy;
    vec2 pj = segment.zw;
    
    // A circle touches an edge when its centre is within its radius of
    // the nearest point on that segment. Repeated vertices are valid.
    vec2 edge = pj - pi;
    if (square) {
      if (segmentTouchesSquare(pi, pj, point, radius * SQUARE_HALF_SIZE)) return true;
    } else {
      float lengthSquared = dot(edge, edge);
      float t = lengthSquared > 0.0 ? clamp(dot(point - pi, edge) / lengthSquared, 0.0, 1.0) : 0.0;
      vec2 delta = point - (pi + t * edge);
      if (dot(delta, delta) <= radius * radius) return true;
    }

    if (((pi.y > point.y) != (pj.y > point.y)) &&
        (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x)) {
      inside = !inside;
    }
  }
  
  return inside;
}

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  // Skip absent (faded-out) points — never select a removed point. exit.G = absent.
  if (texelFetch(exitTexture, pointTexel, 0).g > 0.5) {
    fragColor = vec4(0.0);
    return;
  }

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  // World space to normalized device coordinates (worldOrigin at the screen centre)
  vec2 p = (pointPosition.rg - worldOrigin) * (2.0 / screenSize);
  #ifdef USE_UNIFORM_BUFFERS
  // Convert mat4 to mat3 for vec3 multiplication
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif

  vec4 footprint = texelFetch(pointSize, pointTexel, 0);
  float size = footprint.r * sizeScale;
  if (size <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }
  float radius = 0.5 * max(pointSizePx(size, ratio, transformationMatrix[0][0], scalePointsOnZoom, maxPointSize), 1.0) / ratio;

  // Convert to screen coordinates for polygon check
  vec2 screenPos = (final.xy + 1.0) * screenSize / 2.0;
  
  fragColor = vec4(0.0, 0.0, pointPosition.r, pointPosition.g);
  
  // Only points whose footprints reach the polygon's bounds need to scan
  // its edges. Strict comparisons preserve tangency at the bounds.
  float extent = footprint.g > 0.5 ? radius * SQUARE_HALF_SIZE : radius;
  if (any(lessThan(screenPos + extent, polygonBounds0)) ||
      any(greaterThan(screenPos - extent, polygonBounds1))) return;

  // Select points whose centre is inside or whose footprint touches an edge.
  if (pointInPolygon(screenPos, radius, footprint.g > 0.5, polygonPathTexture, polygonPathLength)) {
    fragColor.r = 1.0;
  }
}
