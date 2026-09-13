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
