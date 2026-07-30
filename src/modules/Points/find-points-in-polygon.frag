#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D polygonPathTexture; // Texture containing polygon path points
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform findPointsInPolygonUniforms {
  float spaceSize;
  vec2 screenSize;
  mat4 transformationMatrix;
  float polygonPathLength;
} findPointsInPolygon;

#define spaceSize findPointsInPolygon.spaceSize
#define screenSize findPointsInPolygon.screenSize
#define transformationMatrix findPointsInPolygon.transformationMatrix
#define polygonPathLength int(findPointsInPolygon.polygonPathLength)
#else
uniform int polygonPathLength;
uniform float spaceSize;
uniform vec2 screenSize;
uniform mat3 transformationMatrix;
#endif

out vec4 fragColor;

// Get a point from the polygon path texture at a specific index
vec2 getPolygonPoint(sampler2D pathTexture, int index, int pathLength) {
  if (index >= pathLength) return vec2(0.0);

  // The path is written row-major into a square texture. Ask the texture how wide it
  // is rather than re-deriving ceil(sqrt(pathLength)) — that duplicates the formula
  // the allocation used, and a local named textureSize would shadow this builtin.
  int width = textureSize(pathTexture, 0).x;

  vec4 pathData = texelFetch(pathTexture, ivec2(index % width, index / width), 0);

  return pathData.xy;
}

// Point-in-polygon algorithm using ray casting
bool pointInPolygon(vec2 point, sampler2D pathTexture, int pathLength) {
  bool inside = false;
  
  for (int i = 0; i < 2048; i++) {
    if (i >= pathLength) break;
    
    int j = int(mod(float(i + 1), float(pathLength)));
    
    vec2 pi = getPolygonPoint(pathTexture, i, pathLength);
    vec2 pj = getPolygonPoint(pathTexture, j, pathLength);
    
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
  vec2 p = 2.0 * pointPosition.rg / spaceSize - 1.0;
  p *= spaceSize / screenSize;
  #ifdef USE_UNIFORM_BUFFERS
  // Convert mat4 to mat3 for vec3 multiplication
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif

  // Convert to screen coordinates for polygon check
  vec2 screenPos = (final.xy + 1.0) * screenSize / 2.0;
  
  fragColor = vec4(0.0, 0.0, pointPosition.r, pointPosition.g);
  
  // Check if point center is inside the polygon
  if (pointInPolygon(screenPos, polygonPathTexture, polygonPathLength)) {
    fragColor.r = 1.0;
  }
} 