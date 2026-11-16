/// <reference types="node" />
import { commands } from 'vitest/browser'
declare module 'vitest/browser' {
  interface BrowserCommands { writeLabArtifact(name: string, json: string): Promise<void> }
}
export async function writeArtifact (name: string, data: unknown): Promise<void> {
  await commands.writeLabArtifact(name, JSON.stringify(data))
}
