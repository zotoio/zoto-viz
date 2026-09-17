/**
 * Browser TypeSafe client — POSTs to the monitor proxy (`/api/typesafe/sense`).
 * The API key never enters the bundle; the monitor reads `TYPESAFE_API_KEY` from
 * its process environment.
 */
import { apiFetch } from "../core/http";
import type { TypeSafeQuestion, TypeSafeSenseResult } from "./typesafe-host";

export interface TypeSafeSdk {
  sense(input: { state: unknown; questions?: TypeSafeQuestion[] }): Promise<TypeSafeSenseResult>;
}

function stubSdk(): TypeSafeSdk {
  return {
    async sense(input) {
      const q = input.questions?.[0]?.id ?? "ping";
      return { answer: { stub: true, question: q, ts: Date.now() } };
    },
  };
}

async function proxySdk(): Promise<TypeSafeSdk> {
  return {
    async sense(input) {
      const r = await apiFetch("/api/typesafe/sense", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: input.state,
          questions: input.questions,
        }),
      });
      if (r.status === 503) throw new Error("typesafe not configured");
      if (!r.ok) throw new Error(`typesafe sense ${r.status}`);
      const data = await r.json() as { answer?: unknown };
      return { answer: data.answer };
    },
  };
}

/** Factory used by {@link TypeSafeHost} after opt-in. */
export async function createTypeSafeSdk(proxyConfigured = false): Promise<TypeSafeSdk> {
  if (!proxyConfigured) return stubSdk();
  try {
    return await proxySdk();
  } catch {
    return stubSdk();
  }
}

/** Probe whether the monitor has `TYPESAFE_API_KEY` configured. */
export async function fetchTypeSafeProxyConfigured(): Promise<boolean> {
  try {
    const r = await apiFetch("/api/typesafe/status");
    if (!r.ok) return false;
    const data = await r.json() as { configured?: boolean };
    return !!data.configured;
  } catch {
    return false;
  }
}
