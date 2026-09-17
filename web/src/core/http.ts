/** Same-origin fetches that carry the CSRF header minted by GET /api/session. */

let csrf = "";

export function csrfToken(): string {
  return csrf;
}

export function noteCsrf(r: Response): void {
  const t = r.headers?.get?.("X-Zoto-Viz-Csrf");
  if (t) csrf = t;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !csrf) await bootSession();
  if (csrf && method !== "GET" && method !== "HEAD") headers.set("X-Zoto-Viz-Csrf", csrf);
  const r = await fetch(path, { ...init, headers, credentials: "same-origin" });
  noteCsrf(r);
  return r;
}

export async function bootSession(): Promise<{
  csrf: string;
  aiControl: boolean;
  pluginService: boolean;
  typesafeConfigured: boolean;
}> {
  try {
    const r = await apiFetch("/api/session");
    if (!r.ok) return { csrf, aiControl: false, pluginService: false, typesafeConfigured: false };
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
    return { csrf, aiControl: false, pluginService: false, typesafeConfigured: false };
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
