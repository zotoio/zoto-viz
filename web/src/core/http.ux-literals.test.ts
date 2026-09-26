import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiFetch, noteCsrf } from "./http";

describe("UX copy literals", () => {
  const orig = globalThis.fetch;
  let onRestart: ((e: Event) => void) | undefined;

  beforeEach(() => {
    expect.hasAssertions();
    noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
  });

  afterEach(() => {
    globalThis.fetch = orig;
    if (onRestart) {
      window.removeEventListener("zoto-viz-server-restart", onRestart);
      onRestart = undefined;
    }
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
    onRestart = (e) => { notices.push((e as CustomEvent<string>).detail); };
    window.addEventListener("zoto-viz-server-restart", onRestart);
    await apiFetch("/api/profiles/user", { method: "PUT" });
    expect(notices[0]).toBe("The server restarted, so packs were reloaded.");
  });
});
