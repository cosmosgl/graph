import { Buffer, Device, ComputePipeline } from '@luma.gl/core'

const WORKGROUP_SIZE = 64

const velocityPositionComputeShaderSource = /* wgsl */ `\
struct VelocityPositionParams {
  diskCount: u32,
  diskRadius: f32,
}

@group(0) @binding(0) var<storage, read_write> diskOffsets: array<f32>;
@group(0) @binding(1) var<storage, read> diskVelocities: array<f32>;
@group(0) @binding(2) var<uniform> params: VelocityPositionParams;

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
  let velocityX = diskVelocities[2u * index];
  let velocityY = diskVelocities[2u * index + 1u];
  
  // Update positions by adding velocity
  positionX += velocityX;
  positionY += velocityY;
  
  // Handle edge bouncing
  let radius = params.diskRadius;
  if (positionX > 1.0 - radius) {
    positionX = 2.0 * (1.0 - radius) - positionX;
  } else if (positionX < -1.0 + radius) {
    positionX = 2.0 * (-1.0 + radius) - positionX;
  }
  
  if (positionY > 1.0 - radius) {
    positionY = 2.0 * (1.0 - radius) - positionY;
  } else if (positionY < -1.0 + radius) {
    positionY = 2.0 * (-1.0 + radius) - positionY;
  }
  
  // Update positions
  diskOffsets[2u * index] = positionX;
  diskOffsets[2u * index + 1u] = positionY;
}
`

export interface VelocityPositionComputeConfig {
  device: Device;
  instanceCount: number;
  positionBuffer: Buffer;
  velocityBuffer: Buffer;
  diskRadius: number;
}

export class VelocityPositionCompute {
  private device: Device
  private instanceCount: number
  private positionBuffer: Buffer
  private velocityBuffer: Buffer
  private diskRadius: number
  private computePipeline: ComputePipeline
  private paramsBuffer: Buffer
  private isBindingsSet: boolean = false

  public constructor (config: VelocityPositionComputeConfig) {
    const { device, instanceCount, positionBuffer, velocityBuffer, diskRadius } = config

    this.device = device
    this.instanceCount = instanceCount
    this.positionBuffer = positionBuffer
    this.velocityBuffer = velocityBuffer
    this.diskRadius = diskRadius

    // Create velocity position params buffer
    const velocityPositionParamsData = new Float32Array([
      instanceCount,
      diskRadius, // diskRadius
    ])
    this.paramsBuffer = device.createBuffer({
      data: velocityPositionParamsData,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
    })

    // Create compute shader and pipeline
    const computeShader = device.createShader({
      stage: 'compute',
      source: velocityPositionComputeShaderSource,
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

  public updateParams (): void {
    const paramsData = new Float32Array([
      this.instanceCount,
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
