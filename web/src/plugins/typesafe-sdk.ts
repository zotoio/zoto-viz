/**
 * TypeSafe / Jev SDK adapter. When `VITE_TYPESAFE_API_KEY` (or alias) is set,
 * lazy-loads `@typesafe-ai/sdk` and calls `TypeSafeClient.systemOne`. Otherwise
 * returns an offline stub (no network) for CI and dark-by-default runs.
 */
import type { TypeSafeQuestion, TypeSafeSenseResult } from "./typesafe-host";
import { resolveTypeSafeApiKey } from "./typesafe-env";

export { resolveTypeSafeApiKey } from "./typesafe-env";

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

async function liveSdk(apiKey: string): Promise<TypeSafeSdk> {
  const { TypeSafeClient, noul } = await import("@typesafe-ai/sdk");
  const client = new TypeSafeClient({ apiKey });
  return {
    async sense(input) {
      const rows = input.questions?.length
        ? input.questions
        : [{ id: "sense", prompt: "Does the monitor state warrant attention?" }];
      const questions = Object.fromEntries(
        rows.map((q) => [q.id, noul(q.prompt)]),
      ) as Record<string, ReturnType<typeof noul>>;
      const state = typeof input.state === "object" && input.state !== null
        ? input.state
        : { value: input.state };
      const response = await client.systemOne({ state, questions });
      return { answer: response.answers };
    },
  };
}

/** Factory used by {@link TypeSafeHost} after opt-in. */
export async function createTypeSafeSdk(): Promise<TypeSafeSdk> {
  const apiKey = resolveTypeSafeApiKey();
  if (!apiKey) return stubSdk();
  try {
    return await liveSdk(apiKey);
  } catch {
    return stubSdk();
  }
}
