import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiFetch, bootSession, csrfToken, noteCsrf, SERVER_RESTART_NOTICE } from "./http";

describe("apiFetch CSRF", () => {
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

  it("sends the header on mutating calls after a session boot", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seen.push(h.get("X-Zoto-Viz-Csrf") || "");
      return {
        ok: true,
        headers: new Headers({ "X-Zoto-Viz-Csrf": "tok" }),
        json: async () => ({ csrf: "tok", aiControl: true, pluginService: false }),
      } as Response;
    }) as typeof fetch;
    const session = await bootSession();
    expect(session.csrf).toBe("tok");
    expect(csrfToken()).toBe("tok");
    await apiFetch("/api/rf/watch", { method: "PUT" });
    expect(seen.at(-1)).toBe("tok");
  });

  it("after restart stale csrf refreshes once retries once and shows restart notice", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      const h = new Headers(init?.headers);
      const sent = h.get("X-Zoto-Viz-Csrf") || "";
      seen.push(`${path}:${sent}`);
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
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "X-Zoto-Viz-Csrf": "fresh" }),
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;
    const notices: string[] = [];
    onRestart = (e) => { notices.push((e as CustomEvent<string>).detail); };
    window.addEventListener("zoto-viz-server-restart", onRestart);
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => { errs.push(String(args[0] ?? "")); };
    const r = await apiFetch("/api/profiles/user", { method: "PUT" });
    console.error = origErr;
    expect(r.ok).toBe(true);
    expect(seen.filter((s) => s.startsWith("/api/session")).length).toBe(1);
    expect(seen.filter((s) => s === "/api/profiles/user:stale").length).toBe(1);
    expect(seen.filter((s) => s === "/api/profiles/user:fresh").length).toBe(1);
    expect(csrfToken()).toBe("fresh");
    expect(notices).toEqual([SERVER_RESTART_NOTICE]);
    expect(errs.length).toBe(0);
  });

  it("treats a failed session boot as unauthenticated", async () => {
    globalThis.fetch = (async () => { throw new Error("down"); }) as typeof fetch;
    const session = await bootSession();
    expect(session.aiControl).toBe(false);
    expect(session.pluginService).toBe(false);
  });

  it("ignores missing csrf headers on mocks", () => {
    noteCsrf({ headers: undefined } as never);
    expect(csrfToken()).toBeTypeOf("string");
  });

  it("treats a non-ok session as empty", async () => {
    globalThis.fetch = (async () => ({ ok: false, headers: { get: () => null }, json: async () => ({}) })) as unknown as typeof fetch;
    const session = await bootSession();
    expect(session.aiControl).toBe(false);
  });
});
