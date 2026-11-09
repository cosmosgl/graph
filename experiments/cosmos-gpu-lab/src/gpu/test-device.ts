import type { Device } from '@luma.gl/core'
import { createDevice } from './luma'

export async function deviceForTest (timestamps = false, errors: string[] = []): Promise<Device | null> {
  try {
    return await createDevice('webgpu', undefined, timestamps, error => { errors.push(error.message); return true })
  } catch (error) {
    if (import.meta.env.REQUIRE_WEBGPU) throw error
    return null
  }
}
