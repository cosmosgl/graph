import type { Buffer, ComputePass } from '@luma.gl/core'

export type ForcePass<T extends unknown[]> = {
  encode(pass: ComputePass, positions: Buffer, ...inputs: T): void;
  destroy(): void;
}
