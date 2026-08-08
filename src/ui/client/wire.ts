import type {
  ExternalSummary,
  JsonValue,
  LogEntry,
  MetricEntry,
  ModelSummary,
  Phase,
  SpanEntry,
} from "@fookiejs/core";
import type { GraphEdge, GraphNode, GraphPort, PlacedNode } from "../../graph/layout.ts";

export type { ExternalSummary, GraphEdge, GraphNode, GraphPort, JsonValue, MetricEntry };
export type { ModelSummary, PlacedNode, SpanEntry };

export type CatalogResponse = {
  models: readonly ModelSummary[];
  externals: readonly ExternalSummary[];
};

export type GraphResponse = {
  nodes: readonly PlacedNode[];
  edges: readonly GraphEdge[];
  width: number;
  height: number;
};

export type RunRow = {
  runId: string;
  model: string;
  entityId: string;
  operation: string;
  phase: Phase;
  error: readonly string[];
  updatedAt: readonly string[];
  body: JsonValue;
};

export type OutboxRow = {
  externalId: string;
  name: string;
  status: string;
  model: string;
  entityId: string;
  runId: string;
  attempt: number;
  stepIndex: number;
  compensationOf: readonly string[];
  error: readonly string[];
  input: JsonValue;
  output: readonly JsonValue[];
};

export type LogRow = Omit<LogEntry, "fields"> & { fields: JsonValue };

export type ObsPage = {
  logs: readonly LogRow[];
  metrics: readonly MetricEntry[];
  spans: readonly SpanEntry[];
  nextSeq: number;
  oldestSeq: number;
};
