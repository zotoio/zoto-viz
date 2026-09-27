import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiFetch, noteCsrf } from "./http";
import { bindServerRestartWallNotice } from "./http-notice";
import { mountWallNoticeRegion } from "./wall-notice-region";

describe("UX copy literals", () => {
  const orig = globalThis.fetch;

  beforeEach(() => {
    expect.hasAssertions();
    noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
  });

  afterEach(() => {
    globalThis.fetch = orig;
    document.body.innerHTML = "";
  });

  it("pins restart notice as exact literal", async () => {
    document.body.innerHTML = "<div id=\"wall\"></div>";
    mountWallNoticeRegion(document.getElementById("wall")!);
    const off = bindServerRestartWallNotice();
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
    await apiFetch("/api/profiles/user", { method: "PUT" });
    const text = document.querySelector(
      '[data-notice-key="server-restarted"] .wall-notice-text',
    )?.textContent ?? "";
    expect(text).toBe("The server restarted, so packs were reloaded.");
    off();
  });

  it("pins retry-failed notice as exact literal", async () => {
    document.body.innerHTML = "<div id=\"wall\"></div>";
    mountWallNoticeRegion(document.getElementById("wall")!);
    const off = bindServerRestartWallNotice();
    globalThis.fetch = (async (url: string) => {
      const path = String(url);
      if (path.includes("/api/session")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "X-Zoto-Viz-Csrf": "fresh" }),
          json: async () => ({ csrf: "fresh", aiControl: false, pluginService: false }),
        } as Response;
      }
      return {
        ok: false,
        status: 403,
        headers: new Headers(),
        clone() { return this; },
        json: async () => ({ error: "csrf required" }),
      } as Response;
    }) as typeof fetch;
    await apiFetch("/api/profiles/user", { method: "PUT" });
    const text = document.querySelector(
      '[data-notice-key="retry-failed"] .wall-notice-text',
    )?.textContent ?? "";
    expect(text).toBe("That request still failed after the server restarted.");
    off();
  });

  it("pins Retry button label as exact literal", async () => {
    document.body.innerHTML = "<div id=\"wall\"></div>";
    mountWallNoticeRegion(document.getElementById("wall")!);
    const off = bindServerRestartWallNotice();
    globalThis.fetch = (async (url: string) => {
      const path = String(url);
      if (path.includes("/api/session")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "X-Zoto-Viz-Csrf": "fresh" }),
          json: async () => ({ csrf: "fresh", aiControl: false, pluginService: false }),
        } as Response;
      }
      return {
        ok: false,
        status: 403,
        headers: new Headers(),
        clone() { return this; },
        json: async () => ({ error: "csrf required" }),
      } as Response;
    }) as typeof fetch;
    await apiFetch("/api/profiles/user", { method: "PUT" });
    const btn = document.querySelector(".wall-notice-action");
    expect(btn?.textContent).toBe("Retry");
    off();
  });
});
