/** Append-only Cursor SDK usage/cost log. Never persist the API key. */
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SECRET_KEY = /^(api[_-]?key|authorization|password|secret|cursor_api_key)$/i;
const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "totalTokens",
  "reasoningTokens",
];

export function cursorStatsPath() {
  const env = String(process.env.ZOTO_VIZ_CURSOR_STATS || "").trim();
  if (env) return env;
  return join(process.env.HOME || homedir(), ".zoto-viz", "cursor-stats.jsonl");
}

function envKey() {
  return String(process.env.CURSOR_API_KEY || "").trim();
}

export function looksLikeKey(value) {
  if (typeof value !== "string" || !value) return false;
  const key = envKey();
  if (key && value.includes(key)) return true;
  return /^(key_|crsr_)[A-Za-z0-9_-]{16,}$/.test(value);
}

export function redactString(value) {
  if (typeof value !== "string") return value;
  const key = envKey();
  let out = key ? value.split(key).join("[redacted]") : value;
  if (looksLikeKey(out)) return "[redacted]";
  return out.length > 2000 ? `${out.slice(0, 2000)}…` : out;
}

export function sanitize(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 8) return undefined;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (typeof value !== "object") return undefined;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

export function pickUsage(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  for (const key of TOKEN_FIELDS) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) out[key] = raw[key];
  }
  return Object.keys(out).length ? out : undefined;
}

export function pickCost(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  if (typeof raw.rawCostCents === "number" && Number.isFinite(raw.rawCostCents)) {
    out.rawCostCents = raw.rawCostCents;
  }
  if (typeof raw.chargedCents === "number" && Number.isFinite(raw.chargedCents)) {
    out.chargedCents = raw.chargedCents;
  }
  return Object.keys(out).length ? out : undefined;
}

export function pickBilled(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  if (typeof raw.error === "string" && raw.error) {
    return { error: redactString(raw.error) };
  }
  const usage = pickUsage(raw.usage);
  const cost = pickCost(raw.cost);
  const runs = Array.isArray(raw.runs)
    ? raw.runs
      .map((row) => {
        if (!row || typeof row !== "object") return undefined;
        const entry = {
          runId: typeof row.runId === "string" ? row.runId : undefined,
          usage: pickUsage(row.usage),
          cost: pickCost(row.cost),
        };
        return entry.usage || entry.cost || entry.runId ? entry : undefined;
      })
      .filter(Boolean)
    : undefined;
  if (!usage && !cost && !runs?.length) return undefined;
  return { usage, cost, runs };
}

export function pickAccount(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  if (typeof raw.apiKeyName === "string" && raw.apiKeyName) out.apiKeyName = redactString(raw.apiKeyName);
  if (typeof raw.userId === "number") out.userId = raw.userId;
  if (typeof raw.userEmail === "string" && raw.userEmail) out.userEmail = redactString(raw.userEmail);
  if (typeof raw.createdAt === "string" && raw.createdAt) out.createdAt = raw.createdAt;
  return Object.keys(out).length ? out : undefined;
}

export function buildRecord(partial) {
  const rec = sanitize({
    id: typeof partial?.id === "string" && partial.id ? partial.id : randomUUID(),
    t: typeof partial?.t === "number" ? partial.t : Date.now() / 1000,
    ...partial,
  });
  return rec && typeof rec === "object" ? rec : { id: randomUUID(), t: Date.now() / 1000 };
}

export function appendStats(partial) {
  const rec = buildRecord(partial);
  const path = cursorStatsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(rec)}\n`, { encoding: "utf8" });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* chmod is best-effort on some fs */
  }
  return rec;
}
