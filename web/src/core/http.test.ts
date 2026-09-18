import { afterEach, describe, expect, it } from "vitest";
import { apiFetch, bootSession, csrfToken, noteCsrf } from "./http";

describe("apiFetch CSRF", () => {
  afterEach(() => {
    globalThis.fetch = orig;
  });
  const orig = globalThis.fetch;

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
    expect(seen[1]).toBe("tok");
  });

  it("reboots the session and retries once on csrf required", async () => {
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
    const r = await apiFetch("/api/profiles/user", { method: "PUT" });
    expect(r.ok).toBe(true);
    expect(seen.some((s) => s.startsWith("/api/session"))).toBe(true);
    expect(seen.some((s) => s === "/api/profiles/user:fresh")).toBe(true);
    expect(csrfToken()).toBe("fresh");
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
