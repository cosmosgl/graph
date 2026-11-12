import { validationContractMarkdown } from './validation'
export type ExperimentInstance = {
  // Stop playback/sweeps at a safe boundary without discarding the current run.
  pause?: () => void;
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
  create: (host: HTMLElement) => Promise<ExperimentInstance>;
  pages: ExperimentPage[];
}

export type ExperimentModule = {
  experiment: ExperimentDefinition;
}

export function defineExperiment (definition: ExperimentDefinition): ExperimentDefinition {
  if (definition.pages.some(page => page.id === 'validation-contract')) throw new Error('Reserved validation-contract page id')
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
