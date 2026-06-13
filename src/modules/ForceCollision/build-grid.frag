#version 300 es
precision highp float;

in vec4 cellData;
out vec4 fragColor;

void main() {
  // Output accumulated cell data (blended additively)
  // xy = sum of positions, z = sum of sizes, w = count
  fragColor = cellData;
}
