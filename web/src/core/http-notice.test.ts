import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_RESTART_NOTICE } from "./http-copy";
import { apiFetch, noteCsrf } from "./http";
import { bindServerRestartWallNotice } from "./http-notice";
import { wallNoticeElements } from "./wall-notice";

function restartStatusNotices(): HTMLElement[] {
  return wallNoticeElements().filter(
    (el) => el.getAttribute("role") === "status" && el.textContent === SERVER_RESTART_NOTICE,
  );
}

describe("server restart wall notice", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("status copy", () => {
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      document.body.innerHTML = "<div id=\"wall\"></div>";
      off = bindServerRestartWallNotice();
    });

    afterEach(() => {
      off();
    });

    it("shows exactly one status notice with the pinned literal", () => {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(restartStatusNotices()).toHaveLength(1);
      expect(restartStatusNotices()[0]!.textContent).toBe(SERVER_RESTART_NOTICE);
    });
  });

  describe("focus", () => {
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      document.body.innerHTML = "<input id=\"focus\" /><div id=\"wall\"></div>";
      const input = document.getElementById("focus") as HTMLInputElement;
      input.focus();
      off = bindServerRestartWallNotice();
    });

    afterEach(() => {
      off();
    });

    it("does not move focus when the notice appears", () => {
      const before = document.activeElement;
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(document.activeElement).toBe(before);
    });
  });

  describe("burst de-duplication", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      document.body.innerHTML = "<div id=\"wall\"></div>";
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
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
      off = bindServerRestartWallNotice();
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
      off();
    });

    it("shows one notice for three stale-token mutations in one burst", async () => {
      await Promise.all([
        apiFetch("/api/a", { method: "PUT" }),
        apiFetch("/api/b", { method: "PUT" }),
        apiFetch("/api/c", { method: "PUT" }),
      ]);
      expect(restartStatusNotices()).toHaveLength(1);
    });
  });

  describe("burst auto-clear timer", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;
    let setTimeoutSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "setTimeout">>;

    beforeEach(() => {
      expect.hasAssertions();
      vi.useFakeTimers();
      setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      document.body.innerHTML = "<div id=\"wall\"></div>";
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
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
      off = bindServerRestartWallNotice();
    });

    afterEach(() => {
      setTimeoutSpy.mockRestore();
      globalThis.fetch = origFetch;
      off();
    });

    it("arms exactly one eight-second auto-clear for three stale-token hits", async () => {
      await Promise.all([
        apiFetch("/api/a", { method: "PUT" }),
        apiFetch("/api/b", { method: "PUT" }),
        apiFetch("/api/c", { method: "PUT" }),
      ]);
      const autoClearArms = setTimeoutSpy.mock.calls.filter((call) => call[1] === 8000);
      expect(autoClearArms).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe("auto clear", () => {
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      vi.useFakeTimers();
      document.body.innerHTML = "<div id=\"wall\"></div>";
      off = bindServerRestartWallNotice();
    });

    afterEach(() => {
      off();
    });

    it("clears the restart notice after eight seconds", () => {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(restartStatusNotices()).toHaveLength(1);
      vi.advanceTimersByTime(8000);
      expect(restartStatusNotices()).toHaveLength(0);
    });
  });

  describe("failed retry", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      document.body.innerHTML = "<div id=\"wall\"></div>";
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
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
      off = bindServerRestartWallNotice();
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
      off();
    });

    it("replaces the restart notice with a Retry failure strip", async () => {
      await apiFetch("/api/profiles/user", { method: "PUT" });
      const notices = wallNoticeElements();
      expect(notices).toHaveLength(1);
      const el = notices[0]!;
      expect(el.textContent).not.toContain(SERVER_RESTART_NOTICE);
      expect(el.querySelector("button.mosaic-wall-notice-retry")?.textContent).toBe("Retry");
    });
  });
});
