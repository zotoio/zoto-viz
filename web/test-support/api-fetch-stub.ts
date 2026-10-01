import { vi } from "vitest";

/** Default loopback API stubs so unit tests never need a monitor on :3000 / :7020. */
function stubApiResponse(url: string): Response | null {
  if (!url.startsWith("/api/")) return null;
  const path = url.split("?")[0] ?? url;
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Zoto-Viz-Csrf": "test-csrf",
    },
  });
  if (path === "/api/session") {
    return json({ csrf: "test-csrf", aiControl: false, pluginService: false, typesafeConfigured: false });
  }
  if (path === "/api/pack-assets/frames") {
    return json({ frameId: "11111111-1111-4111-8111-111111111111" });
  }
  if (path.startsWith("/api/pack-assets/frames/")) {
    return json({ ok: true });
  }
  if (path.startsWith("/api/pack-assets/token/")) {
    const packId = decodeURIComponent(path.slice("/api/pack-assets/token/".length));
    return json({ packId, frameId: "11111111-1111-4111-8111-111111111111", token: `test-token-${packId}` });
  }
  if (path === "/api/sources") return json({ sources: [], live: {} });
  if (path === "/api/plugin-instances") return json({ instances: [] });
  if (path === "/api/sdm") return json({ linked: false });
  if (path === "/api/typesafe/status") return json({ configured: false });
  if (path.startsWith("/api/profiles")) return json({ settings: {}, default: "user", profiles: [] });
  if (path.startsWith("/api/plugins")) return json({ dir: "", schema: "", plugins: [], errors: [], blocked: [] });
  return json({});
}

const realFetch = globalThis.fetch.bind(globalThis);

/** `/api/*` answers from the stubs above; anything else goes to the real fetch. */
const apiFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const stub = stubApiResponse(url);
  if (stub) return Promise.resolve(stub);
  return realFetch(input, init);
};

/** Stub `fetch` with the loopback API (undone by `vi.unstubAllGlobals()`). */
export function stubApiFetch(): void {
  vi.stubGlobal("fetch", apiFetch);
}
