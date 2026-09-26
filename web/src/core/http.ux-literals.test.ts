import { afterEach, describe, expect, it } from "vitest";
import { apiFetch, noteCsrf, resetSessionRecoveryStats } from "./http";

describe("UX copy literals", () => {
  const orig = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = orig;
    resetSessionRecoveryStats();
  });

  it("pins restart notice as exact literal", async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      const h = new Headers(init?.headers);
      const sent = h.get("X-Zoto-Viz-Csrf") || "";
      if (path.includes("/api/session")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "X-Zoto-Viz-Csrf": "fresh" }),
          json: async () => ({ csrf: "fresh", aiControl: false, pluginService: false }),
        } as Response;
      }
      if (sent !== "fresh") {
        return {
          ok: false,
          status: 403,
          headers: new Headers(),
          clone() { return this; },
          json: async () => ({ error: "csrf required" }),
        } as Response;
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) } as Response;
    }) as typeof fetch;
    const notices: string[] = [];
    window.addEventListener("zoto-viz-server-restart", (e) => {
      notices.push((e as CustomEvent<string>).detail);
    });
    noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
    await apiFetch("/api/profiles/user", { method: "PUT" });
    expect(notices).toEqual([
      "The server restarted, so packs were reloaded.",
    ]);
  });
});
