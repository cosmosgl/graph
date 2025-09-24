import {Buffer, Device, luma} from '@luma.gl/core';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {VelocityPositionCompute} from './VelocityPositionCompute';
import {PhysicsCompute} from './PhysicsCompute';
import {GravityCompute} from './GravityCompute';

export interface ComputeManagerConfig {
  canvas?: HTMLCanvasElement;
  diskRadius: number;
}

export interface ComputeSettings {
  physicsEnabled: boolean;
  physicsStrength: number;
  gravityEnabled: boolean;
  gravityStrength: number;
  jiggleStrength?: number;
  springConstant?: number;
  dampingFactor?: number;
}

export class ComputeManager {
  private device!: Device;
  private velocityPositionCompute!: VelocityPositionCompute;
  private physicsCompute!: PhysicsCompute;
  private gravityCompute!: GravityCompute;
  private positionBuffer!: Buffer;
  private velocityBuffer!: Buffer;
  private instanceCount: number = 0;
  private config: ComputeManagerConfig;
  private positions: Float32Array | null = null;
  private isInitialized: boolean = false;
  private startTime: number = Date.now();

  constructor(config: ComputeManagerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.positions === null) {
      throw new Error('Positions must be set via setPointPositions() before calling initialize()');
    }

    const {canvas, diskRadius} = this.config;

    // Create device with default parameters
    // Set canvas context only if canvas is provided, otherwise undefined
    this.device = await luma.createDevice({
      type: 'webgpu',
      adapters: [webgpuAdapter],
      createCanvasContext: canvas ? {canvas} : undefined
    });

    // Create position buffer with stored positions data
    this.positionBuffer = this.device.createBuffer({
      data: this.positions,
      usage: Buffer.VERTEX | Buffer.STORAGE | Buffer.COPY_DST | Buffer.COPY_SRC
    });

    // Create velocity buffer with zeros (2 floats per instance: vx, vy)
    const velocityData = new Float32Array(this.instanceCount * 2); // Initialized to zeros
    this.velocityBuffer = this.device.createBuffer({
      data: velocityData,
      usage: Buffer.STORAGE | Buffer.COPY_DST
    });

    this.velocityPositionCompute = new VelocityPositionCompute({
      device: this.device,
      instanceCount: this.instanceCount,
      positionBuffer: this.positionBuffer,
      velocityBuffer: this.velocityBuffer,
      diskRadius
    });

    this.physicsCompute = new PhysicsCompute({
      device: this.device,
      instanceCount: this.instanceCount,
      velocityBuffer: this.velocityBuffer,
      positionBuffer: this.positionBuffer,
      jiggleStrength: 0.01, // Default jiggle strength
      springConstant: 0.05, // Default spring constant
      dampingFactor: 0.02 // Default damping factor
    });

    this.gravityCompute = new GravityCompute({
      device: this.device,
      instanceCount: this.instanceCount,
      positionBuffer: this.positionBuffer,
      velocityBuffer: this.velocityBuffer,
      diskRadius
    });

    this.isInitialized = true;
  }

  setPointPositions(positions: Float32Array): void {
    // Validate positions array length is even (x, y pairs)
    if (positions.length % 2 !== 0) {
      throw new Error('Positions array length must be even (x, y pairs)');
    }

    // Calculate instanceCount from positions array (2 floats per instance: x, y)
    this.instanceCount = positions.length / 2;
    this.positions = positions;

    // If already initialized, update the position buffer directly
    if (this.isInitialized && this.positionBuffer) {
      this.positionBuffer.write(positions, 0);
    }
  }

  update(settings: ComputeSettings): void {
    // Calculate current time in seconds since start
    const currentTime = (Date.now() - this.startTime) / 1000.0;
    
    // Update parameters for each compute module
    this.velocityPositionCompute.updateParams();
    this.physicsCompute.updateParams(
      settings.physicsStrength, 
      settings.jiggleStrength ?? 0.01, 
      currentTime,
      settings.springConstant ?? 0.05,
      settings.dampingFactor ?? 0.02
    );
    this.gravityCompute.updateParams(settings.gravityStrength);

    // Clean velocity buffer before running physics
    this.cleanVelocityBuffer();

    // Execute compute shaders in order with position updates after each velocity change
    if (settings.gravityEnabled) {
      this.gravityCompute.execute();
      // Apply positions after gravity velocity changes
      this.velocityPositionCompute.execute();
    }

    if (settings.physicsEnabled) {
      this.physicsCompute.execute();
      // Apply positions after physics velocity changes
      this.velocityPositionCompute.execute();
    }
  }

  getPositionBuffer(): Buffer {
    return this.positionBuffer;
  }

  getDevice(): Device {
    return this.device;
  }

  getInstanceCount(): number {
    return this.instanceCount;
  }

  async readPositions(): Promise<Float32Array> {
    // Read the current positions from the GPU buffer
    const data = await this.positionBuffer.readAsync();
    // Convert Uint8Array to Float32Array
    return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  }

  private cleanVelocityBuffer(): void {
    // Reset all velocities to zero
    const zeroVelocities = new Float32Array(this.instanceCount * 2);
    this.velocityBuffer.write(zeroVelocities, 0);
  }

  destroy(): void {
    this.velocityPositionCompute?.destroy();
    this.physicsCompute?.destroy();
    this.gravityCompute?.destroy();
    this.positionBuffer?.destroy();
    this.velocityBuffer?.destroy();
    
    // Always clean up device since we always create it internally
    this.device?.destroy();
  }
}
