export type StudyRecord = {
  schemaVersion: 1;
  experiment: string;
  recordedAt: string;
  sourceRevision: string | null;
  environment: string;
  scope: string;
  question: string;
  method: string;
  conclusion: string;
  checks: Array<{ name: string; outcome: 'Pass' | 'Fail' | 'Measured only' | 'Not assessed'; detail: string }>;
  limits: string;
  visual: string;
  sourcePage: string;
}

// Small, curated historical records do not replace original findings or raw captures.
export function readStudyRecord (value: unknown, experiment: string): StudyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid study record for ${experiment}`)
  const record = value as Record<string, unknown>
  const fields = ['recordedAt', 'environment', 'scope', 'question', 'method', 'conclusion', 'limits', 'visual', 'sourcePage']
  if (record.schemaVersion !== 1 || record.experiment !== experiment ||
    fields.some(key => typeof record[key] !== 'string' || !(record[key] as string).trim()) ||
    !(record.sourceRevision === null || (typeof record.sourceRevision === 'string' && record.sourceRevision.trim())) ||
    !Array.isArray(record.checks) || !record.checks.length || record.checks.some(check =>
    !check || typeof check !== 'object' || typeof check.name !== 'string' || !check.name.trim() ||
    typeof check.detail !== 'string' || !check.detail.trim() ||
    !['Pass', 'Fail', 'Measured only', 'Not assessed'].includes(check.outcome))) {
    throw new Error(`Invalid study record for ${experiment}`)
  }
  return value as StudyRecord
}
