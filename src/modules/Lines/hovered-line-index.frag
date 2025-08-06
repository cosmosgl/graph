precision highp float;

uniform sampler2D linkIndexTexture;
uniform vec2 mousePosition;
uniform vec2 screenSize;

varying vec2 vTexCoord;

void main() {
  // Convert mouse position to texture coordinates
  vec2 texCoord = mousePosition / screenSize;
  
  // Read the link index from the linkIndexFbo texture at mouse position
  vec4 linkIndexData = texture2D(linkIndexTexture, texCoord);
  
  // Extract the link index (stored in the red channel)
  float linkIndex = linkIndexData.r;
  
  // Check if there's a valid link at this position (alpha > 0)
  if (linkIndexData.a > 0.0 && linkIndex >= 0.0) {
    // Output the link index
    gl_FragColor = vec4(linkIndex, 0.0, 0.0, 1.0);
  } else {
    // No link at this position, output -1 to indicate no hover
    gl_FragColor = vec4(-1.0, 0.0, 0.0, 0.0);
  }
} 