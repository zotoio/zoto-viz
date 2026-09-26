/** Same-origin fetches that carry the CSRF header minted by GET /api/session. */

let csrf = "";
let sandboxAssetTokenValue = "";

export function csrfToken(): string {
  return csrf;
}

export function sandboxAssetToken(): string {
  return sandboxAssetTokenValue;
}

/** Vitest: seed session asset token without /api/session. */
export function setSandboxAssetTokenForTests(token: string): void {
  sandboxAssetTokenValue = token;
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

export async function bootSession(): Promise<{
  csrf: string;
  sandboxAssetToken: string;
  aiControl: boolean;
  pluginService: boolean;
  typesafeConfigured: boolean;
}> {
  try {
    const r = await apiFetch("/api/session");
    if (!r.ok) {
      return {
        csrf,
        sandboxAssetToken: sandboxAssetTokenValue,
        aiControl: false,
        pluginService: false,
        typesafeConfigured: false,
      };
    }
    const data = await r.json() as {
      csrf?: string;
      sandboxAssetToken?: string;
      aiControl?: boolean;
      pluginService?: boolean;
      typesafeConfigured?: boolean;
    };
    if (typeof data.csrf === "string" && data.csrf) csrf = data.csrf;
    if (typeof data.sandboxAssetToken === "string" && data.sandboxAssetToken) {
      sandboxAssetTokenValue = data.sandboxAssetToken;
    }
    const typesafeConfigured = typeof data.typesafeConfigured === "boolean"
      ? data.typesafeConfigured
      : await fetchTypeSafeConfiguredFallback();
    return {
      csrf,
      sandboxAssetToken: sandboxAssetTokenValue,
      aiControl: !!data.aiControl,
      pluginService: !!data.pluginService,
      typesafeConfigured,
    };
  } catch {
    return {
      csrf,
      sandboxAssetToken: sandboxAssetTokenValue,
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
