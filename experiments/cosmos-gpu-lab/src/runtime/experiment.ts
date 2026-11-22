import { validationContractMarkdown } from './validation'
import type { AgentFindings } from './agent-findings'
import type { StudyRecord } from './study-record'
import type { ResultChart } from './result-chart'
export type ExperimentInstance = {
  // Stop playback/sweeps at a safe boundary without discarding the current run.
  pause?: () => void;
  // Resume presentation after returning to a retained run, without restarting playback.
  resume?: () => void;
  // Preserve completed evidence when an embedded run must be recreated.
  saveEvidence?: () => unknown;
  restoreEvidence?: (evidence: unknown) => void;
  destroy: () => void;
}

export type MarkdownPage = {
  kind: 'markdown';
  id: string;
  title: string;
  load: () => Promise<string>;
  assets?: Record<string, string>;
  examples?: Record<string, (host: HTMLElement) => void>;
  relatedExperiments?: readonly string[];
}

export type ExperimentReportResult = {
  backend: string;
  values: Record<string, string | number>;
}

export type ExperimentReport = {
  schemaVersion: number;
  experiment: string;
  title: string;
  recordedAt: string;
  status: string;
  commit: string;
  environment: Record<string, string>;
  parameters: Record<string, string | number>;
  results: ExperimentReportResult[];
  notes: string[];
}

export type ReportPage = {
  kind: 'report';
  id: string;
  title: string;
  load: () => Promise<ExperimentReport>;
}

export type ExperimentPage = MarkdownPage | ReportPage

// A case has one question and its own bounded evidence. The files that retain
// detailed research remain attached to the experiment, not copied into the UI.
export type CaseEvidenceLink = { label: string; page: string; section?: string }
export type ExperimentCase = {
  id: string;
  title: string;
  kind: 'compare' | 'demonstrate' | 'explore' | 'measure' | 'recorded';
  question: string;
  description: string;
  tryIt?: string;
  reference: string;
  acceptance: string;
  // A useful method can be available even before there is a recorded result.
  evidence?: CaseEvidenceLink[];
  recorded: {
    conclusion: string;
    date: string;
    environment: string;
    scope: string;
    limits: string;
    evidence: CaseEvidenceLink[];
    charts?: ResultChart[];
  } | null;
}

export function caseEvidenceLinks (item: ExperimentCase): CaseEvidenceLink[] {
  const links = [...item.evidence ?? [], ...item.recorded?.evidence ?? []]
  return links.filter((link, index) => links.findIndex(other => other.page === link.page && other.section === link.section) === index)
}

export type SinglePageCase = {
  observations: Array<{ id: string; title: string; date: string; evidence: string; limits: string; charts?: ResultChart[] }>;
}

export type ExperimentDefinition = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  cases?: ExperimentCase[];
  caseChooserLabel?: string;
  presentation?: 'demo';
  howItWorks?: false | { summary: string; figure?: (host: HTMLElement) => void };
  showPeerLinks?: boolean;
  initialEvidence?: 'first-recorded';
  showRecordedSummary?: boolean;
  singlePage?: SinglePageCase;
  // Optional prototype: a readable recorded result and a linked agent recipe.
  study?: { record: StudyRecord; recipePage: string; visualFirst?: boolean; liveDescription?: string; agentFindings?: AgentFindings };
  create: (host: HTMLElement, caseId?: string) => Promise<ExperimentInstance>;
  pages: ExperimentPage[];
}

export type ExperimentModule = { experiment: ExperimentDefinition } | { experiments: ExperimentDefinition[] }

export function defineExperiment (definition: ExperimentDefinition): ExperimentDefinition {
  if (definition.pages.some(page => page.id === 'validation-contract')) throw new Error('Reserved validation-contract page id')
  if (definition.singlePage && (definition.cases?.length !== 1 || !definition.cases[0].recorded)) {
    throw new Error(`Expected one case with recorded evidence for ${definition.id}`)
  }
  if (definition.study && (definition.study.record.experiment !== definition.id ||
    !definition.pages.some(page => page.id === definition.study!.record.sourcePage) ||
    !definition.pages.some(page => page.id === definition.study!.recipePage))) {
    throw new Error(`Invalid study links for ${definition.id}`)
  }
  if (definition.cases) {
    const ids = new Set<string>()
    if (!definition.cases.length) throw new Error(`Missing cases for ${definition.id}`)
    for (const item of definition.cases) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || ids.has(item.id) ||
        (item.kind === 'recorded' && !item.recorded) ||
        caseEvidenceLinks(item).some(link => !definition.pages.some(page => page.id === link.page))) {
        throw new Error(`Invalid case ${item.id} for ${definition.id}`)
      }
      ids.add(item.id)
    }
  }
  // Resolve eagerly so a new experiment cannot silently omit its comparison contract.
  const contract = validationContractMarkdown(definition.id)
  return {
    ...definition,
    pages: [...definition.pages, {
      kind: 'markdown',
      id: 'validation-contract',
      title: 'Validation contract',
      load: async (): Promise<string> => contract,
    }],
  }
}
