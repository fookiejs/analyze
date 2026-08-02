import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnalyzeServer, defaultOptions } from "../src/server.ts";
import type { AnalyzeSource } from "../src/source.ts";
import type {
  ExternalSummary,
  ModelSummary,
  ObservabilityPage,
  OutboxEntry,
  RunStateRow,
} from "@fookiejs/core";

const models: readonly ModelSummary[] = [
  {
    name: "Order",
    table: "order",
    fields: [
      {
        key: "id",
        column: "id",
        pgType: "UUID",
        relation: [],
        unique: false,
        index: false,
        system: true,
      },
      {
        key: "buyer",
        column: "buyer",
        pgType: "UUID",
        relation: ["User"],
        unique: false,
        index: true,
        system: false,
      },
    ],
  },
  {
    name: "User",
    table: "user",
    fields: [
      {
        key: "id",
        column: "id",
        pgType: "UUID",
        relation: [],
        unique: false,
        index: false,
        system: true,
      },
    ],
  },
];

const externals: readonly ExternalSummary[] = [
  {
    name: "pay.charge",
    attempts: 3,
    backoff: "fixed",
    timeoutMs: 1000,
    inputKeys: ["amount"],
    outputKeys: ["ref"],
    compensate: [],
  },
];

const runRow = {
  runId: "run-1",
  model: "Order",
  entityId: "e1",
  operation: "create",
  body: { email: "a@b.com", password: "hunter2" },
  filterJson: "{}",
  phase: "forward",
  pivotExternalId: [],
  error: [],
  updatedAt: ["2026-01-01T00:00:00.000Z"],
} as unknown as RunStateRow;

const outboxRow = {
  externalId: "v2:run-1:e1:0:pay.charge",
  name: "pay.charge",
  status: "pending",
  model: "Order",
  entityId: "e1",
  runId: "run-1",
  attempt: 1,
  stepIndex: 0,
  error: [],
  input: { amount: 10, apiKey: "sk-live-secret" },
} as unknown as OutboxEntry;

const page = {
  logs: [
    {
      seq: 1,
      level: "info",
      message: "created",
      traceId: "run-1",
      model: "Order",
      entityId: "e1",
      operation: "create",
      timestamp: "2026-01-01T00:00:00.000Z",
      fields: { token: "leak-me", note: "keep" },
    },
  ],
  metrics: [],
  spans: [],
  nextSeq: 1,
  oldestSeq: 1,
} as unknown as ObservabilityPage;

const source: AnalyzeSource = {
  catalog: () => models,
  externalCatalog: () => externals,
  observability: () => page,
  runList: async () => [runRow],
  outboxList: async () => [outboxRow],
  deadLetters: () => [],
};

const port = 24901;
const base = `http://127.0.0.1:${port}`;

describe("analyze server", () => {
  let server: AnalyzeServer;
  let token: string;

  before(() => {
    server = AnalyzeServer.create(source, { ...defaultOptions(), port: [] });
    token = server.accessToken();
    server.run([String(port)]);
  });

  after(async () => {
    await server.stop();
  });

  function auth(path: string, init: RequestInit = {}) {
    return fetch(`${base}${path}`, {
      ...init,
      headers: { "x-analyze-token": token, ...(init.headers ?? {}) },
    });
  }

  it("mints a token when none is configured", () => {
    assert.ok(token.length >= 32, "a generated token must not be guessable");
  });

  it("refuses a request with no token", async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 401);
    await res.text();
  });

  it("refuses a wrong token", async () => {
    const res = await fetch(`${base}/api/health`, {
      headers: { "x-analyze-token": "x".repeat(token.length) },
    });
    assert.equal(res.status, 401);
    await res.text();
  });

  it("refuses a cross origin request even with a valid token", async () => {
    const res = await auth("/api/health", { headers: { origin: "http://evil.example" } });
    assert.equal(res.status, 403);
    await res.text();
  });

  it("refuses anything that is not a GET", async () => {
    const res = await auth("/api/health", { method: "POST" });
    assert.equal(res.status, 405, "this surface exposes no writes at all");
    await res.text();
  });

  it("serves the page with a content security policy and no framing", async () => {
    const res = await auth("/");
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("content-type")), /text\/html/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    const policy = String(res.headers.get("content-security-policy"));
    assert.match(policy, /default-src 'none'/);
    const body = await res.text();
    assert.match(body, /fookie analyze/);

    const headerNonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    assert.ok(headerNonce, "the policy must carry a nonce");
    const styleNonce = /<style nonce="([^"]+)"/.exec(body)?.[1];
    const scriptNonce = /<script nonce="([^"]+)"/.exec(body)?.[1];
    assert.equal(styleNonce, headerNonce, "the style nonce must match the policy");
    assert.equal(scriptNonce, headerNonce, "the script nonce must match the policy");
  });

  it("redacts a secret out of a run body", async () => {
    const res = await auth("/api/runs");
    const rows = (await res.json()) as readonly { body: Record<string, unknown> }[];
    assert.equal(rows.length, 1);
    for (const row of rows) {
      assert.equal(row.body.password, "[redacted]");
      assert.equal(row.body.email, "a@b.com");
    }
  });

  it("redacts a secret out of an outbox input", async () => {
    const res = await auth("/api/outbox");
    const rows = (await res.json()) as readonly { input: Record<string, unknown> }[];
    for (const row of rows) {
      assert.equal(row.input.apiKey, "[redacted]");
      assert.equal(row.input.amount, 10);
    }
  });

  it("redacts a secret out of a log field", async () => {
    const res = await auth("/api/obs?since=0");
    const body = (await res.json()) as { logs: readonly { fields: Record<string, unknown> }[] };
    for (const entry of body.logs) {
      assert.equal(entry.fields.token, "[redacted]");
      assert.equal(entry.fields.note, "keep");
    }
  });

  it("lays out the application map server side", async () => {
    const res = await auth("/api/graph");
    const layout = (await res.json()) as {
      nodes: readonly { id: string; x: number }[];
      edges: readonly { kind: string }[];
    };
    assert.equal(layout.nodes.length, 3, "two models and one external");
    assert.ok(layout.edges.some((edge) => edge.kind === "relation"));
    assert.ok(layout.edges.some((edge) => edge.kind === "invokes"));
  });

  it("caps a page size a caller asks to blow past", async () => {
    const res = await auth("/api/runs?limit=999999");
    assert.equal(res.status, 200);
    await res.json();
  });

  it("answers 404 for an unknown view rather than leaking a stack", async () => {
    const res = await auth("/api/whatever");
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "no such view");
  });
});
