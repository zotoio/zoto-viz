import { describe, expect, it, beforeEach } from "vitest";
import { autoconsentEligible, autoconsentEnabled, autoconsentKind, setAutoconsent } from "./consent";
import type { PluginView } from "./plugin";

const base: PluginView = { id: "x", packName: "X", version: 1, engine: "graph", runtime: "typescript" };

describe("autoconsent", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults off and persists", () => {
    expect(autoconsentEnabled()).toBe(false);
    setAutoconsent(true);
    expect(autoconsentEnabled()).toBe(true);
  });

  it("limits eligible origins", () => {
    expect(autoconsentEligible({ ...base, origin: "src" })).toBe(true);
    expect(autoconsentEligible({ ...base, origin: "local" })).toBe(true);
    expect(autoconsentEligible({ ...base, origin: "zip" })).toBe(false);
    expect(autoconsentEligible(base)).toBe(false);
  });

  it("picks authored for src and reviewed for local", () => {
    expect(autoconsentKind({ ...base, origin: "src" })).toBe("authored");
    expect(autoconsentKind({ ...base, origin: "local" })).toBe("reviewed");
  });
});
