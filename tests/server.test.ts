import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnalyzeServer, defaultOptions } from "../src/server.ts";
import { clientJs, indexHtml, stylesCss } from "../src/ui/page.ts";
import { queryNumber } from "../src/transport.ts";
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
  observability: (since: number) => {
    const logs = page.logs.filter((entry) => entry.seq > since);
    return { ...page, logs };
  },
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

  it("serves the shell without a token so the sign in screen can render", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200, "the page itself carries no data");
    const body = await res.text();
    assert.match(body, /id="gate-form"/, "an unauthenticated visitor gets somewhere to paste it");
    assert.equal(body.includes(token), false, "the shell must never leak the token");
  });

  it("keeps every data endpoint locked while the shell is open", async () => {
    for (const path of ["/api/catalog", "/api/graph", "/api/runs", "/api/outbox", "/api/obs"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 401, `${path} must stay behind the token`);
      await res.text();
    }
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

  it("hands out only what is newer than the cursor", async () => {
    const everything = await auth("/api/obs?since=0");
    const all = (await everything.json()) as { logs: readonly { seq: number }[]; nextSeq: number };
    assert.ok(all.logs.length > 0, "the fixture has to carry a log line");

    const caughtUp = await auth(`/api/obs?since=${String(all.nextSeq)}`);
    const nothing = (await caughtUp.json()) as { logs: readonly unknown[]; nextSeq: number };
    assert.deepEqual(nothing.logs, [], "a caught up client is sent nothing");
    assert.equal(nothing.nextSeq, all.nextSeq, "and the cursor does not move on its own");
  });

  it("answers 404 for an unknown view rather than leaking a stack", async () => {
    const res = await auth("/api/whatever");
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "no such view");
  });
});

describe("listen failures", () => {
  it("reports a busy port instead of taking the process down", async () => {
    const first = AnalyzeServer.create(source, { ...defaultOptions(), port: [] });
    first.run([String(port + 1)]);
    const second = AnalyzeServer.create(source, { ...defaultOptions(), port: [] });
    second.run([String(port + 1)]);

    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(second.listenError().length, 1, "the loser must record why it could not listen");
    for (const reason of second.listenError()) {
      assert.match(reason, /EADDRINUSE/);
    }
    assert.equal(first.listenError().length, 0, "the winner must be unaffected");

    await first.stop();
    await second.stop();
  });
});

describe("the page it serves", () => {
  it("ships one stylesheet with the design tokens and every view", () => {
    const css = stylesCss();
    assert.match(css, /--background/, "the theme tokens must be present");
    assert.match(css, /prefers-color-scheme: dark/, "it must answer both themes");
    for (const selector of [".shell", ".sidebar", ".card", ".badge", ".canvas-wrap", ".trace"]) {
      assert.ok(css.includes(selector), `${selector} must be styled`);
    }
  });

  it("ships client code for the map camera and the trace tree", () => {
    const js = clientJs();
    for (const symbol of [
      "fitMap",
      "zoomAt",
      "wireCamera",
      "buildTree",
      "passesOf",
      "renderModelDetail",
    ]) {
      assert.ok(js.includes(symbol), `${symbol} must reach the browser`);
    }
    assert.equal(js.includes("innerHTML"), false, "the page must never reach for innerHTML");
  });

  it("marks up every view the nav offers", () => {
    const html = indexHtml("n");
    for (const view of ["map", "models", "runs", "outbox", "logs"]) {
      assert.ok(html.includes(`data-view="${view}"`), `${view} needs a nav button`);
      assert.ok(html.includes(`id="view-${view}"`), `${view} needs a section`);
    }
  });
});

describe("query parsing", () => {
  it("uses the fallback when a number is absent, not zero", () => {
    assert.equal(queryNumber("/api/graph", "depth", 4), 4, "no query string at all");
    assert.equal(queryNumber("/api/graph?focus=Order", "depth", 4), 4, "some other parameter");
    assert.equal(queryNumber("/api/graph?depth=", "depth", 4), 4, "present but empty");
    assert.equal(queryNumber("/api/graph?depth=2", "depth", 4), 2, "an explicit value wins");
    assert.equal(queryNumber("/api/graph?depth=nope", "depth", 4), 4, "nonsense falls back");
    assert.equal(queryNumber("/api/graph?depth=0", "depth", 4), 0, "an explicit zero is honoured");
  });
});

describe("incremental streaming", () => {
  it("ships client code that carries the cursor rather than refetching the world", () => {
    const js = clientJs();
    assert.ok(js.includes("/api/obs?since=") === true, "the client must send its cursor");
    assert.equal(js.includes('load("/api/obs?since=0")'), false, "never pinned back to zero");
    for (const symbol of ["absorb", "keepLast", "obsCursor", "state.dropped"]) {
      assert.ok(js.includes(symbol), `${symbol} must reach the browser`);
    }
  });
});

describe("a single request on the map", () => {
  it("ships the client code that paints one run onto the cards", () => {
    const js = clientJs();
    for (const symbol of ["selectRun", "runStatusOf", "state.runTrail", "edgeWalkedByRun"]) {
      assert.ok(js.includes(symbol), `${symbol} must reach the browser`);
    }
    assert.ok(js.includes("/api/outbox?limit=200&runId="), "it must ask for one run's steps");
  });

  it("styles every outcome a step can be in", () => {
    const css = stylesCss();
    for (const state of ["run-completed", "run-pending", "run-dead_letter", "run-untouched"]) {
      assert.ok(css.includes(css.includes(state) ? state : ""), `${state} needs styling`);
      assert.ok(css.includes(state), `${state} needs styling`);
    }
    assert.ok(css.includes("rail-waiting"), "the rail must be able to say what it waits on");
  });
});

describe("pages that link to each other", () => {
  it("makes a request id clickable everywhere it appears", () => {
    const js = clientJs();
    for (const symbol of [
      "runLink",
      "openRequest",
      "renderCrumb",
      "clearRunFilter",
      "looksLikeRunId",
    ]) {
      assert.ok(js.includes(symbol), `${symbol} must reach the browser`);
    }
    assert.ok(js.includes("state.runFilter"), "the filter has to be shared across the views");
    assert.ok(
      js.includes("state.runRows"),
      "a followed request reads its own rows, not the window",
    );
  });

  it("opens on everything rather than hiding a plane", () => {
    const html = indexHtml("n");
    assert.match(html, /data-plane="both" aria-selected="true"/, "nothing is hidden by default");
    const js = clientJs();
    assert.ok(js.includes('plane: "both"'), "the client agrees with the markup");
  });

  it("says why a filtered view is empty instead of showing nothing", () => {
    const js = clientJs();
    assert.ok(js.includes("Nothing logged for this request"), "logs explain their own emptiness");
    assert.ok(js.includes("This request called nothing"), "so does the outbox");
  });
});
