import { Buffer, Device } from '@luma.gl/core'

export function createIndexesForBuffer (textureSize: number): Float32Array {
  const indexes = new Float32Array(textureSize * textureSize * 2)
  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const i = y * textureSize * 2 + x * 2
      indexes[i + 0] = x
      indexes[i + 1] = y
    }
  }
  return indexes
}

/**
 * Creates, resizes, or rewrites a static (non-transitioned) vertex buffer so it holds
 * exactly `data`. Returns the buffer for the caller to assign back to its field.
 * For source/target attribute pairs that animate between updates, use
 * `updateAttributeBuffers` below instead.
 */
export function updateAttributeBuffer (device: Device, buffer: Buffer | undefined, data: Float32Array): Buffer {
  if (!buffer || buffer.byteLength !== data.byteLength) {
    if (buffer && !buffer.destroyed) buffer.destroy()
    return device.createBuffer({ data, usage: Buffer.VERTEX | Buffer.COPY_DST })
  }
  buffer.write(data)
  return buffer
}

export function updateAttributeBuffers (
  device: Device,
  targetData: Float32Array,
  sourceBuffer: Buffer | undefined,
  targetBuffer: Buffer | undefined,
  previousData: Float32Array | undefined,
  tupleSize: 1 | 4
): { source: Buffer; target: Buffer; previous: Float32Array } {
  const oldCount = previousData ? previousData.length / tupleSize : 0
  const newCount = targetData.length / tupleSize
  const sameCount = oldCount === newCount

  // Reuse both buffers when the topology is unchanged so the old target becomes the next source.
  // TODO: Rare edge case - smooth in-flight attribute transitions when updates arrive mid-animation.
  if (sameCount &&
      sourceBuffer && !sourceBuffer.destroyed &&
      targetBuffer && !targetBuffer.destroyed) {
    const nextSource = targetBuffer
    const nextTarget = sourceBuffer
    nextTarget.write(targetData)
    return {
      source: nextSource,
      target: nextTarget,
      previous: new Float32Array(targetData),
    }
  }

  const sourceData = new Float32Array(targetData.length)
  const sharedCount = Math.min(oldCount, newCount)
  for (let i = 0; i < sharedCount * tupleSize; i += 1) {
    sourceData[i] = previousData?.[i] ?? targetData[i] ?? 0
  }
  for (let i = sharedCount * tupleSize; i < targetData.length; i += 1) {
    sourceData[i] = targetData[i] ?? 0
  }

  if (sourceBuffer && !sourceBuffer.destroyed) {
    sourceBuffer.destroy()
  }
  if (targetBuffer && !targetBuffer.destroyed) {
    targetBuffer.destroy()
  }

  return {
    source: device.createBuffer({
      data: sourceData,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    }),
    target: device.createBuffer({
      data: targetData,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    }),
    previous: new Float32Array(targetData),
  }
}
