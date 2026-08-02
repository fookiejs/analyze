import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import http from "node:http";
import crypto from "node:crypto";

export const loopbackHost = "127.0.0.1";

export const maxPageSize = 500;

export function pathOf(rawUrl: http.IncomingMessage["url"]): string {
  const parsed = z.string().min(1).safeParse(rawUrl);
  if (parsed.success === false) {
    return "/";
  }
  return new URL(parsed.data, "http://local").pathname;
}

export function queryNumber(
  rawUrl: http.IncomingMessage["url"],
  key: string,
  fallback: number,
): number {
  const parsed = z.string().min(1).safeParse(rawUrl);
  if (parsed.success === false) {
    return fallback;
  }
  const raw = new URL(parsed.data, "http://local").searchParams.get(key);
  const asNumber = z.coerce.number().int().nonnegative().safeParse(raw);
  if (asNumber.success === false) {
    return fallback;
  }
  return Math.min(asNumber.data, maxPageSize);
}

export function queryList(rawUrl: http.IncomingMessage["url"], key: string): readonly string[] {
  const parsed = z.string().min(1).safeParse(rawUrl);
  if (parsed.success === false) {
    return [];
  }
  let found: readonly string[] = [];
  for (const entry of new URL(parsed.data, "http://local").searchParams.getAll(key)) {
    if (entry.length > 0) {
      found = appendItem(found, entry);
    }
  }
  return found;
}

export function tokenFrom(req: http.IncomingMessage): readonly string[] {
  const header = z.string().min(1).safeParse(req.headers["x-analyze-token"]);
  if (header.success === true) {
    return [header.data];
  }
  const parsed = z.string().min(1).safeParse(req.url);
  if (parsed.success === false) {
    return [];
  }
  const fromQuery = new URL(parsed.data, "http://local").searchParams.get("token");
  const asText = z.string().min(1).safeParse(fromQuery);
  if (asText.success === false) {
    return [];
  }
  return [asText.data];
}

export function tokenMatches(expected: string, offered: readonly string[]): boolean {
  for (const candidate of offered) {
    const left = Buffer.from(expected);
    const right = Buffer.from(candidate);
    if (left.length !== right.length) {
      return false;
    }
    return crypto.timingSafeEqual(left, right);
  }
  return false;
}

export function originAllowed(req: http.IncomingMessage): boolean {
  const origin = z.string().min(1).safeParse(req.headers.origin);
  if (origin.success === false) {
    return true;
  }
  const host = z.string().min(1).safeParse(req.headers.host);
  if (host.success === false) {
    return false;
  }
  try {
    return new URL(origin.data).host === host.data;
  } catch {
    return false;
  }
}

export function nonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

export function newToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function securityHeaders(pageNonce: string): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": [
      "default-src 'none'",
      `script-src 'nonce-${pageNonce}'`,
      `style-src 'nonce-${pageNonce}'`,
      "connect-src 'self'",
    ].join("; "),
  };
}

export function sendJson(res: http.ServerResponse, status: number, payload: unknown): boolean {
  if (res.writableEnded === true) {
    return false;
  }
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
  return true;
}

export function sendHtml(res: http.ServerResponse, body: string, pageNonce: string): boolean {
  if (res.writableEnded === true) {
    return false;
  }
  res.writeHead(200, securityHeaders(pageNonce));
  res.end(body);
  return true;
}

export function openStream(res: http.ServerResponse): boolean {
  if (res.writableEnded === true) {
    return false;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(":ok\n\n");
  return true;
}
