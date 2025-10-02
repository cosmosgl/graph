import { Buffer, Device, ComputePipeline } from '@luma.gl/core'

const WORKGROUP_SIZE = 64

// Shader for clearing the center mass buffer
const clearCentermassComputeShaderSource = /* wgsl */ `\
@group(0) @binding(0) var<storage, read_write> centermassBuffer: array<atomic<i32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index: u32 = globalId.x;
  
  // Only clear the first 4 elements (sumX, sumY, count, padding)
  if (index < 4u) {
    atomicStore(&centermassBuffer[index], 0);
  }
}
`

// Shader for calculating center mass
const centermassComputeShaderSource = /* wgsl */ `\
struct CenterMassParams {
  diskCount: u32,
  positionScale: f32,
  _padding1: u32,  // Padding to align struct to 16-byte boundary (std140/std430 alignment rules)
  _padding2: u32,  // Additional padding to ensure proper uniform buffer alignment
}

// Center mass buffer: [sumX, sumY, count, 0] as 4 i32 values
// We use atomic operations to accumulate integer coordinates
@group(0) @binding(0) var<storage, read_write> diskOffsets: array<f32>;
@group(0) @binding(1) var<storage, read_write> centermassBuffer: array<atomic<i32>>;
@group(0) @binding(2) var<uniform> params: CenterMassParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index: u32 = globalId.x;
  let diskCount: u32 = params.diskCount;
  
  // Prevent extra invocations from doing work
  if (index >= diskCount) {
    return;
  }
  
  // Get position coordinates
  // Memory layout: [x0, y0, x1, y1, x2, y2, ...] - interleaved X/Y coordinates for 2D simulation
  let positionX = diskOffsets[2u * index];
  let positionY = diskOffsets[2u * index + 1u];
  
  // Convert to integer coordinates for atomic operations
  let intX = i32(positionX * params.positionScale);
  let intY = i32(positionY * params.positionScale);
  
  // Atomically add to center mass accumulation
  // centermassBuffer[0] = sumX, centermassBuffer[1] = sumY, centermassBuffer[2] = count
  atomicAdd(&centermassBuffer[0u], intX);
  atomicAdd(&centermassBuffer[1u], intY);
  atomicAdd(&centermassBuffer[2u], 1);
}
`

// Shader for applying center mass force
const centermassForceComputeShaderSource = /* wgsl */ `\
struct CenterMassForceParams {
  diskCount: u32,
  gravityStrength: f32,
  positionScale: f32,
  dampingFactor: f32,
}

// Center mass buffer: [sumX, sumY, count, 0] as 4 i32 values
@group(0) @binding(0) var<storage, read_write> diskOffsets: array<f32>;
@group(0) @binding(1) var<storage, read_write> diskVelocities: array<f32>;
@group(0) @binding(2) var<storage, read_write> centermassBuffer: array<atomic<i32>>;
@group(0) @binding(3) var<uniform> params: CenterMassForceParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index: u32 = globalId.x;
  let diskCount: u32 = params.diskCount;
  
  // Prevent extra invocations from doing work
  if (index >= diskCount) {
    return;
  }
  
  // Process each disk (both X and Y coordinates together)
  // Memory layout: [x0, y0, x1, y1, x2, y2, ...] - interleaved X/Y coordinates for 2D simulation
  var positionX = diskOffsets[2u * index];
  var positionY = diskOffsets[2u * index + 1u];
  var velocityX = diskVelocities[2u * index];
  var velocityY = diskVelocities[2u * index + 1u];
  
  // Read center mass from the centermassBuffer
  let sumX = f32(atomicLoad(&centermassBuffer[0u]));
  let sumY = f32(atomicLoad(&centermassBuffer[1u]));
  let count = f32(atomicLoad(&centermassBuffer[2u]));
  
  // Calculate center mass position
  var centerX: f32;
  var centerY: f32;
  
  if (count > 0.0) {
    centerX = (sumX / count) / params.positionScale;
    centerY = (sumY / count) / params.positionScale;
  } else {
    centerX = 0.0;
    centerY = 0.0;
  }
  
  // Calculate distance vector from center mass
  let distVectorX = centerX - positionX;
  let distVectorY = centerY - positionY;
  let distance = sqrt(distVectorX * distVectorX + distVectorY * distVectorY);
  
  if (distance > 0.0) {
    // Calculate angle using atan2 (WGSL equivalent)
    let angle = atan2(distVectorY, distVectorX);
    
    // Calculate additional velocity using GLSL formula: gravity * dist * dampingFactor
    let additionalVelocity = params.gravityStrength * distance * params.dampingFactor;
    
    // Apply velocity in direction of center mass
    velocityX += additionalVelocity * cos(angle);
    velocityY += additionalVelocity * sin(angle);
  }
  
  // Always update velocities
  diskVelocities[2u * index] = velocityX;
  diskVelocities[2u * index + 1u] = velocityY;
}
`

export interface CenterMassComputeConfig {
  device: Device;
  instanceCount: number;
  positionBuffer: Buffer;
  velocityBuffer?: Buffer;
  strength?: number;
  dampingFactor?: number;
}

export class CenterMassCompute {
  // Class constants
  private static readonly POSITION_SCALE = 1000.0

  private device: Device
  private instanceCount: number
  private positionBuffer: Buffer
  private velocityBuffer?: Buffer
  private strength: number
  private dampingFactor: number
  private clearCentermassComputePipeline: ComputePipeline
  private centermassComputePipeline: ComputePipeline
  private centermassForceComputePipeline?: ComputePipeline
  private centermassParamsBuffer: Buffer
  private centermassForceParamsBuffer?: Buffer
  private centermassBuffer: Buffer
  private isClearCentermassBindingsSet: boolean = false
  private isCentermassBindingsSet: boolean = false
  private isCentermassForceBindingsSet: boolean = false

  public constructor (config: CenterMassComputeConfig) {
    const { device, instanceCount, positionBuffer, velocityBuffer, strength = 2.0, dampingFactor = 0.1 } = config

    this.device = device
    this.instanceCount = instanceCount
    this.positionBuffer = positionBuffer
    this.velocityBuffer = velocityBuffer
    this.strength = strength
    this.dampingFactor = dampingFactor

    // Create center mass buffer: 4 i32 values [sumX, sumY, count, 0]
    const centermassData = new Int32Array(4).fill(0)
    this.centermassBuffer = device.createBuffer({
      data: centermassData,
      usage: Buffer.STORAGE | Buffer.COPY_DST | Buffer.COPY_SRC,
    })

    // Create clear center mass compute shader and pipeline
    const clearCentermassComputeShader = device.createShader({
      stage: 'compute',
      source: clearCentermassComputeShaderSource,
    })

    const clearCentermassShaderLayout = {
      bindings: [
        {
          type: 'storage' as const,
          name: 'centermassBuffer',
          group: 0,
          location: 0,
        },
      ],
    }

    this.clearCentermassComputePipeline = device.createComputePipeline({
      shader: clearCentermassComputeShader,
      entryPoint: 'main',
      shaderLayout: clearCentermassShaderLayout,
    })

    // Create center mass params buffer
    const centermassParamsData = new Float32Array([
      instanceCount,
      CenterMassCompute.POSITION_SCALE,
      0, // padding
      0, // padding
    ])
    this.centermassParamsBuffer = device.createBuffer({
      data: centermassParamsData,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
    })

    // Create center mass compute shader and pipeline
    const centermassComputeShader = device.createShader({
      stage: 'compute',
      source: centermassComputeShaderSource,
    })

    const centermassShaderLayout = {
      bindings: [
        {
          type: 'storage' as const,
          name: 'diskOffsets',
          group: 0,
          location: 0,
        },
        {
          type: 'storage' as const,
          name: 'centermassBuffer',
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

    this.centermassComputePipeline = device.createComputePipeline({
      shader: centermassComputeShader,
      entryPoint: 'main',
      shaderLayout: centermassShaderLayout,
    })

    // Create center mass force compute pipeline if velocity buffer is provided
    if (velocityBuffer) {
      // Create center mass force params buffer
      const centermassForceParamsData = new Float32Array([
        instanceCount,
        this.strength, // strength
        CenterMassCompute.POSITION_SCALE, // positionScale
        this.dampingFactor, // dampingFactor
      ])
      this.centermassForceParamsBuffer = device.createBuffer({
        data: centermassForceParamsData,
        usage: Buffer.UNIFORM | Buffer.COPY_DST,
      })

      // Create center mass force compute shader and pipeline
      const centermassForceComputeShader = device.createShader({
        stage: 'compute',
        source: centermassForceComputeShaderSource,
      })

      const centermassForceShaderLayout = {
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
            type: 'storage' as const,
            name: 'centermassBuffer',
            group: 0,
            location: 2,
          },
          {
            type: 'uniform' as const,
            name: 'params',
            group: 0,
            location: 3,
          },
        ],
      }

      this.centermassForceComputePipeline = device.createComputePipeline({
        shader: centermassForceComputeShader,
        entryPoint: 'main',
        shaderLayout: centermassForceShaderLayout,
      })
    }
  }

  public updateParams (strength?: number, dampingFactor?: number): void {
    // Update center mass params
    const paramsData = new Float32Array([
      this.instanceCount,
      CenterMassCompute.POSITION_SCALE,
      0, // padding
      0, // padding
    ])
    this.centermassParamsBuffer.write(paramsData, 0)

    // Update strength if provided
    if (strength !== undefined) {
      this.strength = strength
    }

    // Update damping factor if provided
    if (dampingFactor !== undefined) {
      this.dampingFactor = dampingFactor
    }

    // Update force params if buffer exists
    if (this.centermassForceParamsBuffer) {
      const forceParamsData = new Float32Array([
        this.instanceCount,
        this.strength,
        CenterMassCompute.POSITION_SCALE,
        this.dampingFactor,
      ])
      this.centermassForceParamsBuffer.write(forceParamsData, 0)
    }
  }

  public execute (): void {
    const commandEncoder = this.device.createCommandEncoder()
    const computePass = commandEncoder.beginComputePass({})

    // First dispatch: clear center mass buffer
    if (!this.isClearCentermassBindingsSet) {
      this.clearCentermassComputePipeline.setBindings({
        centermassBuffer: this.centermassBuffer,
      })
      this.isClearCentermassBindingsSet = true
    }
    computePass.setPipeline(this.clearCentermassComputePipeline)
    computePass.dispatch(1) // Only need 1 workgroup to clear 4 elements

    // Second dispatch: center mass accumulation
    if (!this.isCentermassBindingsSet) {
      this.centermassComputePipeline.setBindings({
        diskOffsets: this.positionBuffer,
        centermassBuffer: this.centermassBuffer,
        params: this.centermassParamsBuffer,
      })
      this.isCentermassBindingsSet = true
    }
    computePass.setPipeline(this.centermassComputePipeline)
    computePass.dispatch(Math.ceil(this.instanceCount / WORKGROUP_SIZE))

    // Third dispatch: force application (if available)
    if (this.centermassForceComputePipeline && this.velocityBuffer && this.centermassForceParamsBuffer) {
      if (!this.isCentermassForceBindingsSet) {
        this.centermassForceComputePipeline.setBindings({
          diskOffsets: this.positionBuffer,
          diskVelocities: this.velocityBuffer,
          centermassBuffer: this.centermassBuffer,
          params: this.centermassForceParamsBuffer,
        })
        this.isCentermassForceBindingsSet = true
      }

      computePass.setPipeline(this.centermassForceComputePipeline)
      computePass.dispatch(Math.ceil(this.instanceCount / WORKGROUP_SIZE))
    }

    computePass.end()
    this.device.submit(commandEncoder.finish())
  }

  public getCentermassBuffer (): Buffer {
    return this.centermassBuffer
  }

  public async getCenterMass (): Promise<{ x: number; y: number; count: number }> {
    // Read the center mass buffer
    const data = await this.centermassBuffer.readAsync()
    const int32Data = new Int32Array(data.buffer, data.byteOffset, data.byteLength / 4)

    const sumX = int32Data[0] ?? 0
    const sumY = int32Data[1] ?? 0
    const count = int32Data[2] ?? 0

    // Convert back to float coordinates
    const centerX = count > 0 ? (sumX / count) / CenterMassCompute.POSITION_SCALE : 0
    const centerY = count > 0 ? (sumY / count) / CenterMassCompute.POSITION_SCALE : 0

    return { x: centerX, y: centerY, count }
  }

  public destroy (): void {
    this.centermassParamsBuffer.destroy()
    this.centermassBuffer.destroy()
    if (this.centermassForceParamsBuffer) {
      this.centermassForceParamsBuffer.destroy()
    }
  }
}
