export function writeLabArtifact (
  context: { project: { config: { root: string } }; testPath?: string }, name: string, json: string
): Promise<void>
