/**
 * Stub TypeSafe / Jev SDK — no network, no API keys. The host lazy-imports this
 * module only when a pack declares `typesafe` and the user opts in.
 */
import type { TypeSafeQuestion, TypeSafeSenseResult } from "./typesafe-host";

export interface TypeSafeSdk {
  sense(input: { state: unknown; questions?: TypeSafeQuestion[] }): Promise<TypeSafeSenseResult>;
}

/** Factory used by {@link TypeSafeHost} after opt-in. Never calls production. */
export async function createTypeSafeSdk(): Promise<TypeSafeSdk> {
  return {
    async sense(input) {
      const q = input.questions?.[0]?.id ?? "ping";
      return { answer: { stub: true, question: q, ts: Date.now() } };
    },
  };
}
