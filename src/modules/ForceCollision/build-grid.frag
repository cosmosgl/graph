#ifdef GL_ES
precision highp float;
#endif

varying vec4 cellData;

void main() {
  // Output accumulated cell data (will be blended additively)
  // xy = sum of positions, z = sum of sizes, w = count
  gl_FragColor = cellData;
}

