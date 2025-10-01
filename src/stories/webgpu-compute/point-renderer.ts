import { Buffer, Device } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { generateInstanceColors, generateInstanceRadii } from './color-utils'
import { SharedStore } from './shared-store'
import { BouncingDisksAppConfig } from './app'

const VERTEX_COUNT = 6 // Simple quad for each disk (2 triangles)

const shaderSource = /* wgsl */ `\
struct Uniforms {
  screenSize: vec2<f32>,
  scalePointSizeWithZoom: f32,
  padding: f32,
  viewMatrix: mat4x4<f32>,
  projectionMatrix: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInputs {
  @location(0) vertexPosition: vec2<f32>,
  @location(1) instanceOffset: vec2<f32>,
  @location(2) instanceColor: vec3<f32>,
  @location(3) instanceRadius: f32,
};

struct FragmentInputs {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) localPosition: vec2<f32>,
  @location(2) radius: f32,
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var output: FragmentInputs;
  
  // Convert pixel radius to normalized coordinates
  // Scale X and Y components separately to maintain circular shape
  let normalizedRadiusX = inputs.instanceRadius / (uniforms.screenSize.x * 0.5);
  let normalizedRadiusY = inputs.instanceRadius / (uniforms.screenSize.y * 0.5);
  
  // Check if we should scale point size with zoom
  if (uniforms.scalePointSizeWithZoom > 0.5) {
    // Original behavior: scale vertices first, then apply view matrix
    let scaledPosition = vec2<f32>(
      inputs.vertexPosition.x * normalizedRadiusX,
      inputs.vertexPosition.y * normalizedRadiusY
    );
    
    // Apply view and projection matrices for zoom/pan
    let worldPosition = vec4<f32>(scaledPosition + inputs.instanceOffset, 0.0, 1.0);
    output.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPosition;
  } else {
    // New behavior: apply view matrix first, then scale in screen space
    // First apply view and projection matrices to the center position (without scaling)
    let centerPosition = vec4<f32>(inputs.instanceOffset, 0.0, 1.0);
    let transformedCenter = uniforms.projectionMatrix * uniforms.viewMatrix * centerPosition;
    
    // Scale the vertex position by normalized radius (in screen space, not world space)
    let scaledPosition = vec2<f32>(
      inputs.vertexPosition.x * normalizedRadiusX,
      inputs.vertexPosition.y * normalizedRadiusY
    );
    
    // Add the scaled position to the transformed center
    output.position = vec4<f32>(
      transformedCenter.xy + scaledPosition,
      transformedCenter.zw
    );
  }
  
  output.color = vec4<f32>(inputs.instanceColor, 1.0);
  // Pass the local position (before offset) to fragment shader for circle calculation
  output.localPosition = inputs.vertexPosition;
  // Pass the average normalized radius to fragment shader for circle calculation
  output.radius = (normalizedRadiusX + normalizedRadiusY) * 0.5;
  return output;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  // Calculate distance from center of the quad
  let distance = length(inputs.localPosition);
  
  // Discard pixels outside the circle (radius = 1.0 since vertex positions are -1 to 1)
  if (distance > 1.0) {
    discard;
  }
  
  return inputs.color;
}
`

export class PointRenderer {
  private model: Model
  private vertexBuffer: Buffer
  private uniformBuffer: Buffer
  private colorBuffer: Buffer
  private radiusBuffer: Buffer
  private instanceColors!: Float32Array
  private instanceRadii!: Float32Array
  private viewMatrix: Float32Array
  private projectionMatrix: Float32Array
  private store: SharedStore
  private config: BouncingDisksAppConfig

  public constructor (device: Device, config: BouncingDisksAppConfig, store: SharedStore) {
    this.store = store
    this.config = config

    // Initialize matrices as identity matrices
    this.viewMatrix = this.createIdentityMatrix()
    this.projectionMatrix = this.createIdentityMatrix()

    // Generate instance data for colors and radii
    this.initializeInstanceData(config.instanceCount)

    // Create instance buffers
    this.colorBuffer = device.createBuffer({
      data: this.instanceColors,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })
    this.radiusBuffer = device.createBuffer({
      data: this.instanceRadii,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    })

    // Generate simple quad geometry
    const vertexCoords = this.generateQuadVertices()
    this.vertexBuffer = device.createBuffer(vertexCoords)

    // Create uniform buffer: screenSize (2 floats) + scalePointSizeWithZoom (1 float) + padding (1 float) + viewMatrix (16 floats) + projectionMatrix (16 floats)
    const uniformData = new Float32Array(2 + 1 + 1 + 16 + 16) // Total: 36 floats
    this.uniformBuffer = device.createBuffer({
      data: uniformData,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
    })

    this.model = new Model(device, {
      source: shaderSource,
      bufferLayout: [
        { name: 'vertexPosition', format: 'float32x2', stepMode: 'vertex', byteStride: 2 * 4 },
        { name: 'instanceOffset', format: 'float32x2', stepMode: 'instance', byteStride: 2 * 4 },
        { name: 'instanceColor', format: 'float32x3', stepMode: 'instance', byteStride: 3 * 4 },
        { name: 'instanceRadius', format: 'float32', stepMode: 'instance', byteStride: 4 },
      ],
      attributes: {
        vertexPosition: this.vertexBuffer,
        instanceOffset: config.positionBuffer,
        instanceColor: this.colorBuffer,
        instanceRadius: this.radiusBuffer,
      },
      bindings: {
        uniforms: this.uniformBuffer,
      },
      vertexCount: VERTEX_COUNT,
      instanceCount: config.instanceCount,
      topology: 'triangle-list',
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  }

  public render (device: Device, clearColor: [number, number, number, number] = [1.0, 1.0, 1.0, 1.0]): void {
    // Update uniform buffer with current screen size and matrices
    const [width, height] = this.store.screenSize

    // Create uniform data array
    const uniformData = new Float32Array(2 + 1 + 1 + 16 + 16)
    uniformData[0] = width
    uniformData[1] = height
    uniformData[2] = this.config.scalePointSizeWithZoom ? 1.0 : 0.0 // scalePointSizeWithZoom
    // index 3 is padding
    uniformData.set(this.viewMatrix, 4) // offset 4 for viewMatrix
    uniformData.set(this.projectionMatrix, 20) // offset 20 for projectionMatrix (4 + 16)

    this.uniformBuffer.write(uniformData, 0)

    const renderPass = device.beginRenderPass({
      clearColor,
    })
    this.model.draw(renderPass)
    renderPass.end()
  }

  // Public methods to update view and projection matrices for zoom/pan
  public setViewMatrix (matrix: Float32Array): void {
    this.viewMatrix.set(matrix)
  }

  public setProjectionMatrix (matrix: Float32Array): void {
    this.projectionMatrix.set(matrix)
  }

  public getViewMatrix (): Float32Array {
    return this.viewMatrix
  }

  public getProjectionMatrix (): Float32Array {
    return this.projectionMatrix
  }

  public destroy (): void {
    this.model.destroy()
    this.vertexBuffer.destroy()
    this.uniformBuffer.destroy()
    this.colorBuffer.destroy()
    this.radiusBuffer.destroy()
  }

  private initializeInstanceData (instanceCount: number): void {
    this.instanceColors = new Float32Array(3 * instanceCount)
    this.instanceRadii = new Float32Array(instanceCount)

    // Generate distributed colors and radii using shared utilities
    const colors = generateInstanceColors(instanceCount)
    const radii = generateInstanceRadii(instanceCount)

    // Initialize colors and radii
    for (let i = 0; i < instanceCount; i++) {
      // Use distributed colors
      const color = colors[i]
      if (color) {
        this.instanceColors[3 * i] = color.r
        this.instanceColors[3 * i + 1] = color.g
        this.instanceColors[3 * i + 2] = color.b
      }

      // Use distributed radii
      const radius = radii[i]
      if (radius !== undefined) {
        this.instanceRadii[i] = radius
      }
    }
  }

  private generateQuadVertices (): Float32Array {
    // Simple quad made of 2 triangles (6 vertices)
    // Triangle 1: (-1, -1), (1, -1), (1, 1)
    // Triangle 2: (-1, -1), (1, 1), (-1, 1)
    return new Float32Array([
      -1, -1, // Triangle 1, vertex 1
      1, -1, // Triangle 1, vertex 2
      1, 1, // Triangle 1, vertex 3
      -1, -1, // Triangle 2, vertex 1
      1, 1, // Triangle 2, vertex 2
      -1, 1, // Triangle 2, vertex 3
    ])
  }

  private createIdentityMatrix (): Float32Array {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ])
  }
}
