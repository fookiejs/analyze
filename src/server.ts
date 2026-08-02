import { z } from "zod";
import http from "node:http";
import { appendItem, isSagaPhase, textOrFallback } from "@fookiejs/core";
import type { Phase } from "@fookiejs/core";
import { AnalyzeError } from "./errors.ts";
import { layoutOf } from "./graph/layout.ts";
import { declaredEdges, nodesOf, observedExternalEdges, observedNestingEdges } from "./map.ts";
import { defaultSensitiveKeys, redact } from "./redact.ts";
import type { AnalyzeSource } from "./source.ts";
import { indexHtml } from "./ui/page.ts";
import {
  loopbackHost,
  newToken,
  nonce,
  openStream,
  originAllowed,
  pathOf,
  queryList,
  queryNumber,
  sendHtml,
  sendJson,
  tokenFrom,
  tokenMatches,
} from "./transport.ts";

export const refreshIntervalMs = 3_000;

export const maxStreamClients = 16;

export type AnalyzeOptions = {
  port: readonly string[];
  token: readonly string[];
  bind: readonly string[];
  deny: readonly string[];
};

export function defaultOptions(): AnalyzeOptions {
  const options: AnalyzeOptions = { port: [], token: [], bind: [], deny: defaultSensitiveKeys };
  if (options.deny.length < 1) {
    throw AnalyzeError.create("a redaction deny list is required");
  }
  return options;
}

function listenPortOf(port: readonly string[]): readonly number[] {
  for (const candidate of port) {
    if (/^\d+$/.test(candidate) === false) {
      throw AnalyzeError.create("port must be digits only");
    }
    const parsed = Number(candidate);
    if (parsed < 0 || parsed > 65535) {
      throw AnalyzeError.create("port out of range");
    }
    return [parsed];
  }
  return [];
}

function phasesFrom(rawUrl: http.IncomingMessage["url"]): readonly Phase[] {
  let phases: readonly Phase[] = [];
  for (const candidate of queryList(rawUrl, "phase")) {
    if (isSagaPhase(candidate) === false) {
      continue;
    }
    phases = appendItem(phases, candidate);
  }
  return phases;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

export class AnalyzeServer {
  private readonly source: AnalyzeSource;
  private readonly token: string;
  private readonly bind: string;
  private readonly deny: readonly string[];
  private readonly serverBox: { servers: readonly http.Server[] } = { servers: [] };
  private readonly clientBox: { clients: readonly http.ServerResponse[] } = { clients: [] };
  private readonly timerBox: { timers: readonly NodeJS.Timeout[] } = { timers: [] };
  private readonly listenErrorBox: { reasons: readonly string[] } = { reasons: [] };

  private constructor(source: AnalyzeSource, options: AnalyzeOptions) {
    this.source = source;
    this.token = textOrFallback(options.token, newToken());
    this.bind = textOrFallback(options.bind, loopbackHost);
    this.deny = options.deny;
  }

  static create(source: AnalyzeSource, options: AnalyzeOptions = defaultOptions()): AnalyzeServer {
    if (z.instanceof(Function).safeParse(source.catalog).success === false) {
      throw AnalyzeError.create("source must expose catalog");
    }
    if (z.instanceof(Function).safeParse(source.observability).success === false) {
      throw AnalyzeError.create("source must expose observability");
    }
    if (options.deny.length < 1) {
      throw AnalyzeError.create("a redaction deny list is required");
    }
    return new AnalyzeServer(source, options);
  }

  accessToken(): string {
    if (this.token.length < 1) {
      throw AnalyzeError.create("access token required");
    }
    return this.token;
  }

  run(port: readonly string[]): boolean {
    if (this.serverBox.servers.length > 0) {
      return true;
    }
    const listening = listenPortOf(port);
    if (listening.length < 1) {
      return false;
    }
    const server = http.createServer((req, res) => {
      const settled = this.handle(req, res).catch(() =>
        sendJson(res, 500, { error: "internal error" }),
      );
      if (settled instanceof Promise === false) {
        throw AnalyzeError.create("request handling must be async");
      }
    });
    server.on("error", (err: Error) => this.reportListenFailure(server, err));
    for (const bound of listening) {
      server.listen(bound, this.bind);
      this.serverBox.servers = [server];
      this.startTicker();
      return true;
    }
    return false;
  }

  private reportListenFailure(server: http.Server, err: Error): boolean {
    const reason = z.string().min(1).safeParse(err.message);
    this.listenErrorBox.reasons = reason.success === true ? [reason.data] : ["listen failed"];
    let kept: readonly http.Server[] = [];
    for (const running of this.serverBox.servers) {
      if (running === server) {
        continue;
      }
      kept = appendItem(kept, running);
    }
    this.serverBox.servers = kept;
    return true;
  }

  listenError(): readonly string[] {
    if (Array.isArray(this.listenErrorBox.reasons) === false) {
      throw AnalyzeError.create("listen error box required");
    }
    if (this.listenErrorBox.reasons.length > 1) {
      throw AnalyzeError.create("only the last listen failure is kept");
    }
    return this.listenErrorBox.reasons;
  }

  private startTicker(): boolean {
    if (this.timerBox.timers.length > 0) {
      return false;
    }
    const timer = setInterval(() => {
      for (const client of this.clientBox.clients) {
        client.write("event: tick\ndata: {}\n\n");
      }
    }, refreshIntervalMs);
    timer.unref();
    this.timerBox.timers = [timer];
    return true;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "this surface is read only" });
      return false;
    }
    if (originAllowed(req) === false) {
      sendJson(res, 403, { error: "cross origin requests are refused" });
      return false;
    }
    if (tokenMatches(this.token, tokenFrom(req)) === false) {
      sendJson(res, 401, { error: "a valid token is required" });
      return false;
    }
    return await this.route(req, res);
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const path = pathOf(req.url);
    if (path === "/") {
      const pageNonce = nonce();
      return sendHtml(res, indexHtml(pageNonce), pageNonce);
    }
    if (path === "/api/health") {
      return sendJson(res, 200, { ok: true, models: this.source.catalog().length });
    }
    if (path === "/api/catalog") {
      return sendJson(res, 200, {
        models: this.source.catalog(),
        externals: this.source.externalCatalog(),
      });
    }
    if (path === "/api/graph") {
      return sendJson(res, 200, await this.graph());
    }
    if (path === "/api/runs") {
      return sendJson(res, 200, await this.runs(req.url));
    }
    if (path === "/api/outbox") {
      return sendJson(res, 200, await this.outbox(req.url));
    }
    if (path === "/api/obs") {
      return sendJson(res, 200, this.observability(req.url));
    }
    if (path === "/api/stream") {
      return this.stream(req, res);
    }
    sendJson(res, 404, { error: "no such view" });
    return false;
  }

  private async graph(): Promise<unknown> {
    const models = this.source.catalog();
    const externals = this.source.externalCatalog();
    const rows = await this.source.outboxList({ status: [], runId: [], limit: 500, offset: 0 });
    let edges = declaredEdges(models, externals);
    for (const edge of observedExternalEdges(rows)) {
      edges = appendItem(edges, edge);
    }
    for (const edge of observedNestingEdges(this.source.observability(0).spans)) {
      edges = appendItem(edges, edge);
    }
    return layoutOf(nodesOf(models, externals), edges);
  }

  private async runs(rawUrl: http.IncomingMessage["url"]): Promise<unknown> {
    const rows = await this.source.runList({
      phase: phasesFrom(rawUrl),
      limit: queryNumber(rawUrl, "limit", 50),
      offset: queryNumber(rawUrl, "offset", 0),
    });
    let cleaned: readonly unknown[] = [];
    for (const row of rows) {
      cleaned = appendItem(cleaned, {
        runId: row.runId,
        model: row.model,
        entityId: row.entityId,
        operation: row.operation,
        phase: row.phase,
        error: row.error,
        updatedAt: row.updatedAt,
        body: redact(row.body, this.deny),
      });
    }
    return cleaned;
  }

  private async outbox(rawUrl: http.IncomingMessage["url"]): Promise<unknown> {
    const rows = await this.source.outboxList({
      status: [],
      runId: queryList(rawUrl, "runId"),
      limit: queryNumber(rawUrl, "limit", 50),
      offset: queryNumber(rawUrl, "offset", 0),
    });
    let cleaned: readonly unknown[] = [];
    for (const row of rows) {
      cleaned = appendItem(cleaned, {
        externalId: row.externalId,
        name: row.name,
        status: row.status,
        model: row.model,
        entityId: row.entityId,
        runId: row.runId,
        attempt: row.attempt,
        stepIndex: row.stepIndex,
        error: row.error,
        input: redact(row.input, this.deny),
      });
    }
    return cleaned;
  }

  private observability(rawUrl: http.IncomingMessage["url"]): unknown {
    const page = this.source.observability(queryNumber(rawUrl, "since", 0));
    let logs: readonly unknown[] = [];
    for (const entry of page.logs) {
      logs = appendItem(logs, {
        seq: entry.seq,
        level: entry.level,
        message: entry.message,
        traceId: entry.traceId,
        model: entry.model,
        entityId: entry.entityId,
        operation: entry.operation,
        timestamp: entry.timestamp,
        fields: redact(entry.fields, this.deny),
      });
    }
    return {
      logs,
      metrics: page.metrics,
      spans: page.spans,
      nextSeq: page.nextSeq,
      oldestSeq: page.oldestSeq,
    };
  }

  private stream(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (this.clientBox.clients.length >= maxStreamClients) {
      sendJson(res, 503, { error: "too many live viewers" });
      return false;
    }
    openStream(res);
    this.clientBox.clients = appendItem(this.clientBox.clients, res);
    req.on("close", () => this.drop(res));
    return true;
  }

  private drop(res: http.ServerResponse): boolean {
    const before = this.clientBox.clients.length;
    let kept: readonly http.ServerResponse[] = [];
    for (const client of this.clientBox.clients) {
      if (client === res) {
        continue;
      }
      kept = appendItem(kept, client);
    }
    this.clientBox.clients = kept;
    return kept.length < before;
  }

  liveViewers(): number {
    return this.clientBox.clients.length;
  }

  async stop(): Promise<boolean> {
    for (const timer of this.timerBox.timers) {
      clearInterval(timer);
    }
    this.timerBox.timers = [];
    for (const client of this.clientBox.clients) {
      client.end();
    }
    this.clientBox.clients = [];
    const running = this.serverBox.servers.slice();
    this.serverBox.servers = [];
    for (const server of running) {
      await closeServer(server);
      return true;
    }
    return false;
  }
}

export function analyze(
  source: AnalyzeSource,
  options: AnalyzeOptions = defaultOptions(),
): AnalyzeServer {
  const server = AnalyzeServer.create(source, options);
  if (options.port.length > 0) {
    server.run(options.port);
  }
  return server;
}
