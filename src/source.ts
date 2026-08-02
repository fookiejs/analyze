import type {
  ExternalSummary,
  LogEntry,
  MetricEntry,
  ModelSummary,
  ObservabilityPage,
  OutboxEntry,
  OutboxQuery,
  RunQuery,
  RunStateRow,
  SpanEntry,
} from "@fookiejs/core";

export type AnalyzeSource = {
  catalog(): readonly ModelSummary[];
  externalCatalog(): readonly ExternalSummary[];
  observability(since: number): ObservabilityPage;
  runList(query: RunQuery): Promise<readonly RunStateRow[]>;
  outboxList(query: OutboxQuery): Promise<readonly OutboxEntry[]>;
  deadLetters(): OutboxEntry[];
};

export type { ExternalSummary, LogEntry, MetricEntry, ModelSummary, OutboxEntry, SpanEntry };
