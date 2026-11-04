import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogErrorHint, noteCatalogError, resetCatalogWarningsForTests } from "./catalog-warnings";

beforeEach(() => resetCatalogWarningsForTests());

describe("plugin catalog warnings", () => {
  it("logs each file+message once per page load", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    for (let i = 0; i < 5; i++) noteCatalogError("/p/local/sea-turtle.zip", "viz: 'idle' is a required property", log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0].join(" "))).toMatch(/viz\.idle/);
  });

  it("a local zip shadowed by a first-party pack is info, not a warning", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    noteCatalogError("/p/local/syscon.zip", "src catalog owns id 'syscon'", log);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(catalogErrorHint("src catalog owns id 'syscon'").hint).toMatch(/delete it/);
  });

  it("unknown errors stay warnings without a hint", () => {
    expect(catalogErrorHint("boom")).toEqual({ level: "warn", hint: "" });
  });
});
