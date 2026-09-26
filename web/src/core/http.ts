/** Same-origin fetches that carry the CSRF header minted by GET /api/session. */

import { SERVER_RESTART_NOTICE, SESSION_RETRY_FAILED_NOTICE } from "./http-copy";

export { SERVER_RESTART_NOTICE } from "./http-copy";

let csrf = "";

let sessionRefreshInFlight: Promise<void> | null = null;
let restartNoticeEmitted = false;

if (typeof window !== "undefined") {
  window.addEventListener("zoto-viz-server-restart-cleared", () => {
    restartNoticeEmitted = false;
  });
}

export function csrfToken(): string {
  return csrf;
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

async function refreshSessionAfterStaleToken(): Promise<void> {
  if (!sessionRefreshInFlight) {
    sessionRefreshInFlight = (async () => {
      csrf = "";
      await bootSession();
      if (typeof window !== "undefined" && !restartNoticeEmitted) {
        restartNoticeEmitted = true;
        window.dispatchEvent(
          new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
        );
      }
    })().finally(() => {
      sessionRefreshInFlight = null;
    });
  }
  await sessionRefreshInFlight;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  let r = await send(path, init);
  if (method !== "GET" && method !== "HEAD" && r.status === 403) {
    const err = await r.clone().json().catch(() => ({})) as { error?: string };
    if (err.error === "csrf required") {
      await refreshSessionAfterStaleToken();
      r = await send(path, init);
      if (!r.ok && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("zoto-viz-mutate-retry-failed", {
            detail: {
              message: SESSION_RETRY_FAILED_NOTICE,
              retry: () => apiFetch(path, init),
            },
          }),
        );
      }
    }
  }
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
