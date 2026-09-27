import { describe, expect, it } from "vitest";
import {
  AUTH_SETUPS,
  bindSourceOf,
  queryValue,
  sourceAuthKind,
  sourceAuthReady,
  viewAuthBlock,
} from "./auth-setup";

describe("auth-setup", () => {
  it("reads query keys and classifies shipped sources", () => {
    expect(queryValue("https://content.guardianapis.com/search?page-size=50&api-key=test", "api-key")).toBe("test");
    expect(queryValue("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=40", "api_key")).toBe("DEMO_KEY");
    expect(sourceAuthKind("guardian", "")).toBe("guardian");
    expect(sourceAuthKind("x", "https://content.guardianapis.com/search")).toBe("guardian");
    expect(sourceAuthKind("apod", "")).toBe("apod");
    expect(sourceAuthKind("nasa", "https://www.nasa.gov/feeds/iotd-feed")).toBeNull();
  });

  it("treats Guardian test key as unconfigured until a real key or a live page lands", () => {
    const url = "https://content.guardianapis.com/search?api-key=test";
    expect(sourceAuthReady("guardian", url)).toBe(false);
    expect(sourceAuthReady("guardian", url.replace("test", "abc123"))).toBe(true);
    expect(sourceAuthReady("guardian", url, { ok: true, items: [{ title: "Storm" }] })).toBe(true);
  });

  it("keeps APOD in dice on DEMO_KEY unless NASA rejects; host key clears 429 gate", () => {
    const url = "https://api.nasa.gov/planetary/apod";
    expect(sourceAuthReady("apod", url)).toBe(true);
    expect(sourceAuthReady("apod", url, { ok: false, error: "http 429" })).toBe(false);
    expect(sourceAuthReady("apod", url, { ok: false, error: "http 429" }, { nasaApiKeyConfigured: true })).toBe(true);
  });

  it("blocks Nest and Guardian views from dice until they are ready", () => {
    expect(viewAuthBlock({ id: "plugin:nest-cams", pluginId: "nest-cams" }, {})?.id).toBe("sdm");
    expect(viewAuthBlock({ id: "plugin:nest-cams", pluginId: "nest-cams" }, { sdmLinked: true })).toBeNull();
    const sources = {
      guardian: { url: "https://content.guardianapis.com/search?api-key=test", ok: false, error: "http 401" },
    };
    expect(viewAuthBlock({ id: "plugin:hn-rain:guardian", pluginId: "hn-rain", source: "guardian" }, { sources })?.id).toBe("guardian");
    expect(viewAuthBlock({
      id: "plugin:hn-rain:guardian", pluginId: "hn-rain", source: "guardian",
    }, { sources: { guardian: { url: sources.guardian.url.replace("test", "abc"), ok: true, items: [{}] } } })).toBeNull();
    expect(viewAuthBlock({ id: "plugin:carousel:apod", pluginId: "carousel", source: "apod" }, {
      sources: { apod: { url: "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY", ok: true, items: [{}] } },
    })).toBeNull();
    expect(viewAuthBlock({ id: "plugin:x", pluginId: "x", capabilities: ["typesafe"] }, {})?.id).toBe("typesafe");
    expect(viewAuthBlock({ id: "plugin:x", pluginId: "x", capabilities: ["typesafe"] }, { typesafeConfigured: true })).toBeNull();
  });

  it("reads the bound source field and ships configure links", () => {
    expect(bindSourceOf({ config: [{ key: "source", value: "guardian" }] })).toBe("guardian");
    expect(AUTH_SETUPS.guardian.links.some((l) => l.href.includes("open-platform.theguardian.com"))).toBe(true);
    expect(AUTH_SETUPS.sdm.links.some((l) => l.href.includes("developers.google.com/nest"))).toBe(true);
    expect(AUTH_SETUPS.cursor.links.some((l) => l.href.includes("cursor.com/dashboard/api"))).toBe(true);
    expect(AUTH_SETUPS.apod.links.some((l) => l.href.includes("api.nasa.gov"))).toBe(true);
    expect(AUTH_SETUPS.elevenlabs.links.some((l) => l.href.includes("elevenlabs.io"))).toBe(true);
  });
});
