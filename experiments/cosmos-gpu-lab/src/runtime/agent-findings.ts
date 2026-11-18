export type AgentFinding = {
  id: string;
  status: 'complete' | 'incomplete';
  recordedAt: string;
  question: string;
  result: string;
  limits: string;
  environment: string;
  evidence: string;
  source: { revision: string | null; state: 'clean' | 'modified' | 'unknown'; snapshot: string | null };
  reproduction: string[];
  evidenceSection?: string;
  replaySection?: string;
}

export type AgentFindings = { records: AgentFinding[]; invalid: string[] }

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const revision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

// Invalid agent-authored records should not prevent the experiment or other findings from loading.
export function readAgentFindings (files: Record<string, string>, experiment: string): AgentFindings {
  const records: AgentFinding[] = []; const invalid: string[] = []
  for (const [path, contents] of Object.entries(files)) {
    const filename = path.split('/').at(-1) ?? ''
    const id = filename.endsWith('.json') ? filename.slice(0, -5) : ''
    try {
      const value: unknown = JSON.parse(contents)
      if (!object(value) || !slug.test(id) || value.schemaVersion !== 1 || value.experiment !== experiment ||
        !['complete', 'incomplete'].includes(value.status as string) ||
        !['recordedAt', 'question', 'result', 'limits', 'environment', 'evidence'].every(key => text(value[key])) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.recordedAt as string) ||
        Number.isNaN(Date.parse(`${String(value.recordedAt)}T00:00:00Z`)) ||
        new Date(`${String(value.recordedAt)}T00:00:00Z`).toISOString().slice(0, 10) !== value.recordedAt ||
        !object(value.source) || !['clean', 'modified', 'unknown'].includes(value.source.state as string) ||
        !(value.source.revision === null || (text(value.source.revision) && revision.test(value.source.revision))) ||
        !(value.source.snapshot === null || text(value.source.snapshot)) ||
        (value.source.state === 'clean' && (!value.source.revision || value.source.snapshot !== null)) ||
        (value.source.state === 'modified' && (!value.source.revision || !value.source.snapshot)) ||
        (value.source.state === 'unknown' && value.status !== 'incomplete') ||
        !Array.isArray(value.reproduction) || !value.reproduction.length || !value.reproduction.every(text) ||
        !['evidenceSection', 'replaySection'].every(key => value[key] === undefined || (text(value[key]) && slug.test(value[key] as string)))) {
        throw new Error('Invalid finding')
      }
      records.push({ ...value, id } as AgentFinding)
    } catch { invalid.push(path) }
  }
  records.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id))
  return { records, invalid }
}
