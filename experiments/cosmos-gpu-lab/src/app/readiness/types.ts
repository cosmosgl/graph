export type ReadinessTone = 'pass' | 'review' | 'fail' | 'neutral'
export type EvidenceTone = 'pass' | 'warn' | 'fail' | 'info' | 'unknown'

// These are reviewed summaries of recorded evidence, never a live verdict.
export type CaseReadiness = {
  badge: string;
  tone: ReadinessTone;
  finding: string;
  area: 'Integration' | 'Research';
  status: string;
  evidence: Array<{ tone: EvidenceTone; text: string }>;
  next: string;
}
