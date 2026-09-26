/** Same-origin fetches that carry the CSRF header minted by GET /api/session. */

let csrf = "";
const packTokenCache = new Map<string, string>();

export function csrfToken(): string {
  return csrf;
}

/** @deprecated use per-pack tokens from {@link mintPackAssetToken} */
export function sandboxAssetToken(): string {
  return packTokenCache.get("_sandbox") ?? "";
}

/** Vitest: seed a pack asset token without POST /api/pack-assets/token/… */
export function setPackAssetTokenForTests(packId: string, token: string): void {
  packTokenCache.set(packId, token);
}

export function setSandboxAssetTokenForTests(token: string): void {
  setPackAssetTokenForTests("_sandbox", token);
}

export function noteCsrf(r: Response): void {
  const t = r.headers?.get?.("X-Zoto-Viz-Csrf");
  if (t) csrf = t;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !csrf) await bootSession();
  if (csrf && method !== "GET" && method !== "HEAD") headers.set("X-Zoto-Viz-Csrf", csrf);
  const r = await fetch(path, { ...init, headers, credentials: "same-origin" });
  noteCsrf(r);
  return r;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  let r = await send(path, init);
  if (method !== "GET" && method !== "HEAD" && r.status === 403) {
    const err = await r.clone().json().catch(() => ({})) as { error?: string };
    if (err.error === "csrf required") {
      csrf = "";
      await bootSession();
      r = await send(path, init);
    }
  }
  return r;
}

export async function mintPackAssetToken(packId: string): Promise<string> {
  const cached = packTokenCache.get(packId);
  if (cached) return cached;
  await bootSession();
  const r = await apiFetch(`/api/pack-assets/token/${encodeURIComponent(packId)}`, { method: "POST" });
  if (!r.ok) throw new Error(`pack asset token unavailable (${packId})`);
  const data = await r.json() as { token?: string };
  if (!data.token) throw new Error("pack asset token missing");
  packTokenCache.set(packId, data.token);
  return data.token;
}

export async function bootSession(): Promise<{
  csrf: string;
  aiControl: boolean;
  pluginService: boolean;
  typesafeConfigured: boolean;
}> {
  try {
    const r = await apiFetch("/api/session");
    if (!r.ok) {
      return {
        csrf,
        aiControl: false,
        pluginService: false,
        typesafeConfigured: false,
      };
    }
    const data = await r.json() as {
      csrf?: string;
      aiControl?: boolean;
      pluginService?: boolean;
      typesafeConfigured?: boolean;
    };
    if (typeof data.csrf === "string" && data.csrf) csrf = data.csrf;
    const typesafeConfigured = typeof data.typesafeConfigured === "boolean"
      ? data.typesafeConfigured
      : await fetchTypeSafeConfiguredFallback();
    return {
      csrf,
      aiControl: !!data.aiControl,
      pluginService: !!data.pluginService,
      typesafeConfigured,
    };
  } catch {
    return {
      csrf,
      aiControl: false,
      pluginService: false,
      typesafeConfigured: false,
    };
  }
}

async function fetchTypeSafeConfiguredFallback(): Promise<boolean> {
  try {
    const r = await apiFetch("/api/typesafe/status");
    if (!r.ok) return false;
    const data = await r.json() as { configured?: boolean };
    return !!data.configured;
  } catch {
    return false;
  }
}
