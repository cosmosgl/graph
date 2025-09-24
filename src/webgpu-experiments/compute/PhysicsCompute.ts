import {Buffer, Device, ComputePipeline} from '@luma.gl/core';

const WORKGROUP_SIZE = 64;

const physicsComputeShaderSource = /* wgsl */ `\
struct PhysicsParams {
  diskCount: u32,
  physicsStrength: f32,
  jiggleStrength: f32,
  time: f32,
  springConstant: f32,
  dampingFactor: f32,
}

@group(0) @binding(0) var<storage, read_write> diskVelocities: array<f32>;
@group(0) @binding(1) var<storage, read> diskPositions: array<f32>;
@group(0) @binding(2) var<uniform> params: PhysicsParams;

// Simple random number generator using golden ratio hash
fn randomFloat(seed: u32) -> f32 {
  var h = seed;
  h = h ^ (h >> 16u);
  h = h * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = h * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / f32(0xffffffffu);
}

// Generate random value in range [-1, 1]
fn randomRange(seed: u32) -> f32 {
  return randomFloat(seed) * 2.0 - 1.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  let diskCount = params.diskCount;
  
  // Prevent extra invocations from doing work
  if (index >= diskCount) {
    return;
  }
  
  let strength = params.physicsStrength;
  let jiggleStrength = params.jiggleStrength;
  let time = params.time;
  let springConstant = params.springConstant;
  let dampingFactor = params.dampingFactor;
  
  // Process each disk (both X and Y coordinates together)
  var velocityX = diskVelocities[2u * index];
  var velocityY = diskVelocities[2u * index + 1u];
  let positionX = diskPositions[2u * index];
  let positionY = diskPositions[2u * index + 1u];
  
  // Calculate distance from center (0, 0)
  let distanceFromCenterX = 0.0 - positionX;
  let distanceFromCenterY = 0.0 - positionY;
  let distanceFromCenter = sqrt(distanceFromCenterX * distanceFromCenterX + distanceFromCenterY * distanceFromCenterY);
  
  // Apply spring force towards center (Hooke's law: F = -k * x)
  let springForceX = springConstant * distanceFromCenterX * strength;
  let springForceY = springConstant * distanceFromCenterY * strength;
  
  // Apply damping to prevent infinite oscillation (F = -c * v)
  let dampingForceX = -dampingFactor * velocityX;
  let dampingForceY = -dampingFactor * velocityY;
  
  // Create smooth oscillation around center using sine waves
  let baseFrequency = 2.0; // Base oscillation frequency
  let particleFrequencyOffset = f32(index) * 0.1; // Slight frequency variation per particle
  let oscillationX = sin(time * baseFrequency + particleFrequencyOffset) * jiggleStrength;
  let oscillationY = sin(time * baseFrequency + particleFrequencyOffset + 1.57) * jiggleStrength; // 90 degree phase shift
  
  // Add some random variation to make it more natural
  let timeBasedSeed = u32(time * 100.0) + index * 17u;
  let randomVariationX = randomRange(timeBasedSeed + 123u) * jiggleStrength * 0.3;
  let randomVariationY = randomRange(timeBasedSeed + 456u) * jiggleStrength * 0.3;
  
  // Combine all forces: spring force + damping + oscillation + random variation
  velocityX += springForceX + dampingForceX + oscillationX + randomVariationX;
  velocityY += springForceY + dampingForceY + oscillationY + randomVariationY;
  
  // Update velocities
  diskVelocities[2u * index] = velocityX;
  diskVelocities[2u * index + 1u] = velocityY;
}
`;

export interface PhysicsComputeConfig {
  device: Device;
  instanceCount: number;
  velocityBuffer: Buffer;
  positionBuffer: Buffer;
  jiggleStrength?: number;
  springConstant?: number;
  dampingFactor?: number;
}

export class PhysicsCompute {
  private device: Device;
  private instanceCount: number;
  private velocityBuffer: Buffer;
  private positionBuffer: Buffer;
  private computePipeline: ComputePipeline;
  private paramsBuffer: Buffer;
  private bindingsSet: boolean = false;

  constructor(config: PhysicsComputeConfig) {
    const {
      device, 
      instanceCount, 
      velocityBuffer, 
      positionBuffer,
      jiggleStrength = 0.01,
      springConstant = 0.05,
      dampingFactor = 0.02
    } = config;
    
    this.device = device;
    this.instanceCount = instanceCount;
    this.velocityBuffer = velocityBuffer;
    this.positionBuffer = positionBuffer;

    // Create physics params buffer with new spring parameters
    const physicsParamsData = new Float32Array([
      instanceCount, 
      1.0, // physicsStrength
      jiggleStrength, // jiggleStrength
      0.0, // time
      springConstant, // springConstant
      dampingFactor // dampingFactor
    ]);
    this.paramsBuffer = device.createBuffer({
      data: physicsParamsData,
      usage: Buffer.UNIFORM | Buffer.COPY_DST
    });

    // Create compute shader and pipeline
    const computeShader = device.createShader({
      stage: 'compute',
      source: physicsComputeShaderSource
    });
    
    const shaderLayout = {
      bindings: [
        {
          type: 'storage' as const, 
          name: 'diskVelocities',
          group: 0,
          location: 0
        },
        {
          type: 'storage' as const,
          name: 'diskPositions',
          group: 0,
          location: 1
        },
        {
          type: 'uniform' as const,
          name: 'params',
          group: 0,
          location: 2
        }
      ]
    };
    
    this.computePipeline = device.createComputePipeline({
      shader: computeShader,
      entryPoint: 'main',
      shaderLayout
    });
  }

  updateParams(
    strength: number, 
    jiggleStrength?: number, 
    time?: number,
    springConstant?: number,
    dampingFactor?: number
  ): void {
    const paramsData = new Float32Array([
      this.instanceCount, 
      strength,
      jiggleStrength ?? 0.01, // Keep current jiggle strength if not provided
      time ?? 0.0, // Keep current time if not provided
      springConstant ?? 0.05, // Keep current spring constant if not provided
      dampingFactor ?? 0.02 // Keep current damping factor if not provided
    ]);
    this.paramsBuffer.write(paramsData, 0);
  }

  execute(): void {
    if (!this.bindingsSet) {
      this.computePipeline.setBindings({
        diskVelocities: this.velocityBuffer,
        diskPositions: this.positionBuffer,
        params: this.paramsBuffer
      });
      this.bindingsSet = true;
    }

    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass({});
    
    computePass.setPipeline(this.computePipeline);
    computePass.dispatch(Math.ceil(this.instanceCount / WORKGROUP_SIZE));
    
    computePass.end();
    this.device.submit(commandEncoder.finish());
  }

  destroy(): void {
    this.paramsBuffer.destroy();
  }
}
