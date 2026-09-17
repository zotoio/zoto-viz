/** Env bag for {@link resolveTypeSafeApiKey} — inject in tests. */
export interface TypeSafeEnvBag {
  viteTypesafeApiKey?: string;
  typesafeApiKey?: string;
  processTypesafeApiKey?: string;
  processViteTypesafeApiKey?: string;
}

function trimKey(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  return t ? t : undefined;
}

/** Read browser (Vite) and Node env for TypeSafe keys. */
export function readTypeSafeEnv(): TypeSafeEnvBag {
  const meta = typeof import.meta !== "undefined"
    ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    : undefined;
  const procEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return {
    viteTypesafeApiKey: meta?.VITE_TYPESAFE_API_KEY,
    typesafeApiKey: meta?.TYPESAFE_API_KEY,
    processTypesafeApiKey: procEnv?.TYPESAFE_API_KEY,
    processViteTypesafeApiKey: procEnv?.VITE_TYPESAFE_API_KEY,
  };
}

/**
 * Resolve a TypeSafe API key for client-side Sense.
 * Order: `VITE_TYPESAFE_API_KEY` → `TYPESAFE_API_KEY` (import.meta.env) →
 * `process.env.TYPESAFE_API_KEY` → `process.env.VITE_TYPESAFE_API_KEY`.
 */
export function resolveTypeSafeApiKey(env: TypeSafeEnvBag = readTypeSafeEnv()): string | undefined {
  return trimKey(env.viteTypesafeApiKey)
    ?? trimKey(env.typesafeApiKey)
    ?? trimKey(env.processTypesafeApiKey)
    ?? trimKey(env.processViteTypesafeApiKey);
}
