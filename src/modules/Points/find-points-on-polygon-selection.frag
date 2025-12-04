#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D polygonPathTexture; // Texture containing polygon path points

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform findPointsOnPolygonSelectionUniforms {
  float spaceSize;
  vec2 screenSize;
  mat4 transformationMatrix;
  float polygonPathLength;
} findPointsOnPolygonSelection;

#define spaceSize findPointsOnPolygonSelection.spaceSize
#define screenSize findPointsOnPolygonSelection.screenSize
#define transformationMatrix findPointsOnPolygonSelection.transformationMatrix
#define polygonPathLength int(findPointsOnPolygonSelection.polygonPathLength)
#else
uniform int polygonPathLength;
uniform float spaceSize;
uniform vec2 screenSize;
uniform mat3 transformationMatrix;
#endif

in vec2 textureCoords;

out vec4 fragColor;

// Get a point from the polygon path texture at a specific index
vec2 getPolygonPoint(sampler2D pathTexture, int index, int pathLength) {
  if (index >= pathLength) return vec2(0.0);
  
  // Calculate texture coordinates for the index
  int textureSize = int(ceil(sqrt(float(pathLength))));
  int x = index - (index / textureSize) * textureSize;
  int y = index / textureSize;
  
  vec2 texCoord = (vec2(float(x), float(y)) + 0.5) / float(textureSize);
  vec4 pathData = texture(pathTexture, texCoord);
  
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
  vec4 pointPosition = texture(positionsTexture, textureCoords);
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