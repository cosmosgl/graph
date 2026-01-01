#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D linkIndexTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform hoveredLineIndexUniforms {
  vec2 mousePosition;
  vec2 screenSize;
} hoveredLine;

#define mousePosition hoveredLine.mousePosition
#define screenSize hoveredLine.screenSize
#else
uniform vec2 mousePosition;
uniform vec2 screenSize;
#endif

in vec2 vTexCoord;

out vec4 fragColor;

void main() {
  // Convert mouse position to texture coordinates
  vec2 texCoord = mousePosition / screenSize;
  
  // Read the link index from the linkIndexFbo texture at mouse position
  vec4 linkIndexData = texture(linkIndexTexture, texCoord);
  
  // Extract the link index (stored in the red channel)
  float linkIndex = linkIndexData.r;
  
  // Check if there's a valid link at this position (alpha > 0)
  if (linkIndexData.a > 0.0 && linkIndex >= 0.0) {
    // Output the link index
    fragColor = vec4(linkIndex, 0.0, 0.0, 1.0);
  } else {
    // No link at this position, output -1 to indicate no hover
    fragColor = vec4(-1.0, 0.0, 0.0, 0.0);
  }
} 