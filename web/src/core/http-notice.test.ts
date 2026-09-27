import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_RESTART_NOTICE, SESSION_RETRY_FAILED_NOTICE } from "./http-copy";
import { apiFetch, noteCsrf } from "./http";
import { bindServerRestartWallNotice } from "./http-notice";
import { mountWallNoticeRegion } from "./wall-notice-region";

function bootNoticeBinding(): () => void {
  document.body.innerHTML = "<div id=\"wall\"></div>";
  mountWallNoticeRegion(document.getElementById("wall")!);
  return bindServerRestartWallNotice();
}

function noticeRows(): HTMLElement[] {
  return [...document.querySelectorAll(".wall-notice-row")] as HTMLElement[];
}

function restartRows(): HTMLElement[] {
  return [...document.querySelectorAll('[data-notice-key="server-restarted"]')] as HTMLElement[];
}

function retryRows(): HTMLElement[] {
  return [...document.querySelectorAll('[data-notice-key="retry-failed"]')] as HTMLElement[];
}

function laneRole(row: Element): string | null {
  return row.parentElement?.getAttribute("role") ?? null;
}

function staleCsrfFetch(sessionHits: { count: number }) {
  return (async (url: string, init?: RequestInit) => {
    const path = String(url);
    const h = new Headers(init?.headers);
    const sent = h.get("X-Zoto-Viz-Csrf") || "";
    if (path.includes("/api/session")) {
      sessionHits.count += 1;
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
}

describe("server restart wall notice", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.dispatchEvent(new Event("zoto-viz-server-restart-cleared"));
    document.body.innerHTML = "";
  });

  describe("status copy", () => {
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      off = bootNoticeBinding();
    });

    afterEach(() => {
      off();
    });

    it("replaces the prior restart strip when a second restart event arrives", () => {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(restartRows()).toHaveLength(1);
    });

    it("shows exactly one status notice with the pinned literal", () => {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(restartRows()).toHaveLength(1);
      expect(restartRows()[0]!.querySelector(".wall-notice-text")!.textContent).toBe(SERVER_RESTART_NOTICE);
      expect(laneRole(restartRows()[0]!)).toBe("status");
    });

    it("ignores restart events whose detail is not the pinned literal", () => {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: "other copy" }),
      );
      expect(noticeRows()).toHaveLength(0);
    });
  });

  describe("click dismiss", () => {
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      off = bootNoticeBinding();
    });

    afterEach(() => {
      off();
    });

    it("clears the restart strip when the notice body is clicked", () => {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(restartRows()).toHaveLength(1);
      restartRows()[0]!.click();
      expect(restartRows()).toHaveLength(0);
    });
  });

  describe("parallel session refresh", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      off = bootNoticeBinding();
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
      off();
    });

    it("coalesces three parallel stale-token refreshes into one session fetch", async () => {
      const sessionHits = { count: 0 };
      globalThis.fetch = staleCsrfFetch(sessionHits);
      await Promise.all([
        apiFetch("/api/a", { method: "PUT" }),
        apiFetch("/api/b", { method: "PUT" }),
        apiFetch("/api/c", { method: "PUT" }),
      ]);
      expect(sessionHits.count).toBe(1);
    });
  });

  describe("burst de-duplication", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      globalThis.fetch = staleCsrfFetch({ count: 0 });
      off = bootNoticeBinding();
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
      expect(restartRows()).toHaveLength(1);
    });

    it("emits one restart event for two sequential stale bursts without restart-cleared", async () => {
      const events: string[] = [];
      const onRestart = (e: Event) => { events.push((e as CustomEvent<string>).detail); };
      window.addEventListener("zoto-viz-server-restart", onRestart);
      await apiFetch("/api/a", { method: "PUT" });
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      await apiFetch("/api/b", { method: "PUT" });
      window.removeEventListener("zoto-viz-server-restart", onRestart);
      expect(events).toEqual([SERVER_RESTART_NOTICE]);
    });

    it("emits a restart event for each stale-token burst separated by restart-cleared", async () => {
      const events: string[] = [];
      const onRestart = (e: Event) => { events.push((e as CustomEvent<string>).detail); };
      window.addEventListener("zoto-viz-server-restart", onRestart);
      await apiFetch("/api/a", { method: "PUT" });
      window.dispatchEvent(new Event("zoto-viz-server-restart-cleared"));
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      await apiFetch("/api/b", { method: "PUT" });
      window.removeEventListener("zoto-viz-server-restart", onRestart);
      expect(events).toEqual([SERVER_RESTART_NOTICE, SERVER_RESTART_NOTICE]);
    });
  });

  describe("burst auto-clear timer", () => {
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      vi.useFakeTimers();
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      globalThis.fetch = staleCsrfFetch({ count: 0 });
      off = bootNoticeBinding();
    });

    afterEach(() => {
      off();
    });

    it("arms exactly one eight-second auto-clear for three restart events", () => {
      for (let i = 0; i < 3; i += 1) {
        window.dispatchEvent(
          new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
        );
      }
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe("auto clear", () => {
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      vi.useFakeTimers();
      off = bootNoticeBinding();
    });

    afterEach(() => {
      off();
    });

    it("clears the restart notice after eight seconds", () => {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(restartRows()).toHaveLength(1);
      vi.advanceTimersByTime(8000);
      expect(restartRows()).toHaveLength(0);
    });
  });

  describe("restart cleared", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      globalThis.fetch = staleCsrfFetch({ count: 0 });
      off = bootNoticeBinding();
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
      off();
    });

    it("shows the restart notice again after a cleared burst and a new stale mutation", async () => {
      await apiFetch("/api/a", { method: "PUT" });
      expect(restartRows()).toHaveLength(1);
      restartRows()[0]!.click();
      expect(restartRows()).toHaveLength(0);
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
      await apiFetch("/api/b", { method: "PUT" });
      expect(restartRows()).toHaveLength(1);
    });
  });

  describe("failed retry", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;

    beforeEach(() => {
      expect.hasAssertions();
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
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
      off = bootNoticeBinding();
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
      off();
    });

    it("replaces the restart notice with a Retry failure strip", async () => {
      await apiFetch("/api/profiles/user", { method: "PUT" });
      expect(retryRows()).toHaveLength(1);
      const row = retryRows()[0]!;
      expect(row.querySelector(".wall-notice-text")!.textContent).toBe(SESSION_RETRY_FAILED_NOTICE);
      expect(laneRole(row)).toBe("status");
    });

    it("keeps the retry failure strip after the restart auto-clear timer fires", async () => {
      vi.useFakeTimers();
      await apiFetch("/api/profiles/user", { method: "PUT" });
      expect(retryRows()).toHaveLength(1);
      vi.advanceTimersByTime(8000);
      expect(retryRows()).toHaveLength(1);
      expect(retryRows()[0]!.querySelector(".wall-notice-text")!.textContent).toBe(SESSION_RETRY_FAILED_NOTICE);
    });
  });

  describe("retry button", () => {
    const origFetch = globalThis.fetch;
    let off: () => void;
    let profileHits: number;

    beforeEach(() => {
      expect.hasAssertions();
      profileHits = 0;
      noteCsrf({ headers: new Headers({ "X-Zoto-Viz-Csrf": "stale" }) } as Response);
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
        if (path === "/api/profiles/user") {
          profileHits += 1;
          if (profileHits >= 3) {
            return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) } as Response;
          }
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
      off = bootNoticeBinding();
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
      off();
    });

    it("replays the failed mutation when Retry is clicked", async () => {
      await apiFetch("/api/profiles/user", { method: "PUT" });
      const btn = document.querySelector(".wall-notice-action") as HTMLButtonElement;
      btn.click();
      await vi.waitFor(() => {
        expect(profileHits).toBe(3);
      });
    });

    it("does not dismiss the retry strip when Retry is clicked", async () => {
      const stopSpy = vi.spyOn(Event.prototype, "stopPropagation");
      await apiFetch("/api/profiles/user", { method: "PUT" });
      const btn = document.querySelector(".wall-notice-action") as HTMLButtonElement;
      btn.click();
      expect(stopSpy).toHaveBeenCalled();
      expect(retryRows()).toHaveLength(1);
      stopSpy.mockRestore();
    });

    it("replays the failed mutation when Retry is focused and click retries", async () => {
      await apiFetch("/api/profiles/user", { method: "PUT" });
      const btn = document.querySelector(".wall-notice-action") as HTMLButtonElement;
      expect(btn.tabIndex).toBe(0);
      btn.focus();
      expect(document.activeElement).toBe(btn);
      btn.click();
      await vi.waitFor(() => {
        expect(profileHits).toBe(3);
      });
    });

    it("shows Retry as an exact literal on the action button", async () => {
      await apiFetch("/api/profiles/user", { method: "PUT" });
      const btn = document.querySelector(".wall-notice-action") as HTMLButtonElement;
      expect(btn.textContent).toBe("Retry");
    });
  });
});
