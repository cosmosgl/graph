import { validationContractMarkdown } from './validation'
import type { StudyRecord } from './study-record'
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

export type ExperimentDefinition = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  // Optional prototype: a readable recorded result and a linked agent recipe.
  study?: { record: StudyRecord; recipePage: string; visualFirst?: boolean; liveDescription?: string };
  create: (host: HTMLElement) => Promise<ExperimentInstance>;
  pages: ExperimentPage[];
}

export type ExperimentModule = {
  experiment: ExperimentDefinition;
}

export function defineExperiment (definition: ExperimentDefinition): ExperimentDefinition {
  if (definition.pages.some(page => page.id === 'validation-contract')) throw new Error('Reserved validation-contract page id')
  if (definition.study && (definition.study.record.experiment !== definition.id ||
    !definition.pages.some(page => page.id === definition.study!.record.sourcePage) ||
    !definition.pages.some(page => page.id === definition.study!.recipePage))) {
    throw new Error(`Invalid study links for ${definition.id}`)
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
