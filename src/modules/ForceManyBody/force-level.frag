#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D levelFbo;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceUniforms {
  float level;
  float levels;
  float levelTextureSize;
  float repulsion;
  float alpha;
  float spaceSize;
  float theta;
} force;

#define level force.level
#define levels force.levels
#define levelTextureSize force.levelTextureSize
#define repulsion force.repulsion
#define alpha force.alpha
#define spaceSize force.spaceSize
#define theta force.theta
#else
uniform float level;
uniform float levels;
uniform float levelTextureSize;
uniform float repulsion;
uniform float alpha;
uniform float spaceSize;
uniform float theta;
#endif

in vec2 textureCoords;
out vec4 fragColor;

const float MAX_LEVELS_NUM = 14.0;

vec2 calculateAdditionalVelocity (vec2 ij, vec2 pp) {
  vec2 add = vec2(0.0);
  vec4 centermass = texture(levelFbo, ij);
  if (centermass.r > 0.0 && centermass.g > 0.0 && centermass.b > 0.0) {
    vec2 centermassPosition = vec2(centermass.rg / centermass.b);
    vec2 distVector = pp - centermassPosition;
    float l = dot(distVector, distVector);
    float dist = sqrt(l);
    if (l > 0.0) {
      float c = alpha * repulsion * centermass.b;

      float distanceMin2 = 1.0;
      if (l < distanceMin2) l = sqrt(distanceMin2 * l);
      float addV = c / sqrt(l);
      add = addV * normalize(distVector);
    }
  }
  return add;
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  float x = pointPosition.x;
  float y = pointPosition.y;

  float left = 0.0;
  float top = 0.0;
  float right = spaceSize;
  float bottom = spaceSize;

  float n_left = 0.0;
  float n_top = 0.0;
  float n_right = 0.0;
  float n_bottom = 0.0;

  float cellSize = 0.0;

  // Iterate over levels to adjust the boundaries based on the current level
  for (float i = 0.0; i < MAX_LEVELS_NUM; i += 1.0) {
    if (i <= level) {
      left += cellSize * n_left;
      top += cellSize * n_top;
      right -= cellSize * n_right;
      bottom -= cellSize * n_bottom;

      cellSize = pow(2.0 , levels - i - 1.0);

      float dist_left = x - left;
      n_left = max(0.0, floor(dist_left / cellSize - theta));

      float dist_top = y - top;
      n_top = max(0.0, floor(dist_top / cellSize - theta));
      
      float dist_right = right - x;
      n_right = max(0.0, floor(dist_right / cellSize - theta));

      float dist_bottom = bottom - y;
      n_bottom = max(0.0, floor(dist_bottom / cellSize - theta));

    }
  }

  vec4 velocity = vec4(vec2(0.0), 1.0, 0.0);

  // Calculate the additional velocity based on neighboring cells
  for (float i = 0.0; i < 12.0; i += 1.0) {
    for (float j = 0.0; j < 4.0; j += 1.0) {
      float n = left + cellSize * j;
      float m = top + cellSize * n_top + cellSize * i;

      if (n < (left + n_left * cellSize) && m < bottom) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }

      n = left + cellSize * i;
      m = top + cellSize * j;

      if (n < (right - n_right * cellSize) && m < (top + n_top * cellSize)) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }

      n = right - n_right * cellSize + cellSize * j;
      m = top + cellSize * i;

      if (n < right && m < (bottom - n_bottom * cellSize)) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }

      n = left + n_left * cellSize + cellSize * i;
      m = bottom - n_bottom * cellSize + cellSize * j;

      if (n < right && m < bottom) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }
    }
  }

  fragColor = velocity;
}