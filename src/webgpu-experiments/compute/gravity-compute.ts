import { Buffer, Device, ComputePipeline } from '@luma.gl/core'

const WORKGROUP_SIZE = 64

const gravityComputeShaderSource = /* wgsl */ `\
struct GravityParams {
  diskCount: u32,
  gravityStrength: f32,
  diskRadius: f32,
}

@group(0) @binding(0) var<storage, read_write> diskOffsets: array<f32>;
@group(0) @binding(1) var<storage, read_write> diskVelocities: array<f32>;
@group(0) @binding(2) var<uniform> params: GravityParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  let diskCount = params.diskCount;
  
  // Prevent extra invocations from doing work
  if (index >= diskCount) {
    return;
  }
  
  
  // Process each disk (both X and Y coordinates together)
  var positionX = diskOffsets[2u * index];
  var positionY = diskOffsets[2u * index + 1u];
  var velocityX = diskVelocities[2u * index];
  var velocityY = diskVelocities[2u * index + 1u];
  
  // Calculate center position - for canvas coordinates (-1 to 1), center is at (0, 0)
  let centerX = 0.0;
  let centerY = 0.0;
  
  // Calculate distance vector from center
  let distVectorX = centerX - positionX;
  let distVectorY = centerY - positionY;
  let distance = sqrt(distVectorX * distVectorX + distVectorY * distVectorY);
  
  if (distance > 0.0) {
    // Calculate angle using atan2 (WGSL equivalent)
    let angle = atan2(distVectorY, distVectorX);
    
    // Calculate additional velocity using GLSL formula: gravity * dist * 0.1
    let additionalVelocity = params.gravityStrength * distance * 0.1;
    
    // Apply velocity in direction of center
    velocityX += additionalVelocity * cos(angle);
    velocityY += additionalVelocity * sin(angle);
  }
  
  
  // Always update velocities
  diskVelocities[2u * index] = velocityX;
  diskVelocities[2u * index + 1u] = velocityY;
}
`

export interface GravityComputeConfig {
  device: Device;
  instanceCount: number;
  positionBuffer: Buffer;
  velocityBuffer: Buffer;
  diskRadius: number;
}

export class GravityCompute {
  private device: Device
  private instanceCount: number
  private positionBuffer: Buffer
  private velocityBuffer: Buffer
  private diskRadius: number
  private computePipeline: ComputePipeline
  private paramsBuffer: Buffer
  private isBindingsSet: boolean = false

  public constructor (config: GravityComputeConfig) {
    const { device, instanceCount, positionBuffer, velocityBuffer, diskRadius } = config

    this.device = device
    this.instanceCount = instanceCount
    this.positionBuffer = positionBuffer
    this.velocityBuffer = velocityBuffer
    this.diskRadius = diskRadius

    // Create gravity params buffer
    const gravityParamsData = new Float32Array([
      instanceCount,
      2.0, // gravityStrength
      diskRadius, // diskRadius
    ])
    this.paramsBuffer = device.createBuffer({
      data: gravityParamsData,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
    })

    // Create compute shader and pipeline
    const computeShader = device.createShader({
      stage: 'compute',
      source: gravityComputeShaderSource,
    })

    const shaderLayout = {
      bindings: [
        {
          type: 'storage' as const,
          name: 'diskOffsets',
          group: 0,
          location: 0,
        },
        {
          type: 'storage' as const,
          name: 'diskVelocities',
          group: 0,
          location: 1,
        },
        {
          type: 'uniform' as const,
          name: 'params',
          group: 0,
          location: 2,
        },
      ],
    }

    this.computePipeline = device.createComputePipeline({
      shader: computeShader,
      entryPoint: 'main',
      shaderLayout,
    })
  }

  public updateParams (gravityStrength: number): void {
    const paramsData = new Float32Array([
      this.instanceCount,
      gravityStrength,
      this.diskRadius,
    ])
    this.paramsBuffer.write(paramsData, 0)
  }

  public execute (): void {
    if (!this.isBindingsSet) {
      this.computePipeline.setBindings({
        diskOffsets: this.positionBuffer,
        diskVelocities: this.velocityBuffer,
        params: this.paramsBuffer,
      })
      this.isBindingsSet = true
    }

    const commandEncoder = this.device.createCommandEncoder()
    const computePass = commandEncoder.beginComputePass({})

    computePass.setPipeline(this.computePipeline)
    computePass.dispatch(Math.ceil(this.instanceCount / WORKGROUP_SIZE))

    computePass.end()
    this.device.submit(commandEncoder.finish())
  }

  public destroy (): void {
    this.paramsBuffer.destroy()
  }
}
