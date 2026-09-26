import { describe, expect, it, vi } from "vitest";
import {
  manifestBlockedCatalog,
  manifestBlockedViewSelectRow,
  renderManifestBlockedPanel,
  resetManifestBlockedCatalogForTests,
  setManifestBlockedCatalog,
} from "./plugin-manifest-blocked";

describe("manifest blocked catalog UI", () => {
  it("renders blocked message and retry control", () => {
    resetManifestBlockedCatalogForTests();
    setManifestBlockedCatalog([{
      id: "marble-run",
      name: "Marble Run",
      file: "/plugins/src/marble-run/plugin.yml",
      blocked: true,
      reasonCode: "manifest_unknown_keys",
      message:
        "marble-run uses manifest keys this version of zoto-viz doesn't recognise (dataMapping, workBudget)",
      keys: ["dataMapping", "workBudget"],
    }]);
    expect(manifestBlockedViewSelectRow()?.label).toBe("Blocked (1)");
    const host = document.createElement("div");
    renderManifestBlockedPanel(host);
    expect(host.textContent).toMatch(/marble-run/);
    expect(host.textContent).toMatch(/dataMapping/);
    expect(host.textContent).toMatch(/workBudget/);
    expect(host.querySelector("[data-action=retry-catalog]")).toBeTruthy();
  });

  it("syncs from installPlugins scan payload shape", async () => {
    resetManifestBlockedCatalogForTests();
    const http = await import("../core/http");
    const { installPlugins } = await import("./plugin");
    vi.spyOn(http, "apiFetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        dir: "",
        schema: "",
        plugins: [],
        errors: [],
        blocked: [{
          id: "x",
          name: "X",
          file: "x/plugin.yml",
          blocked: true,
          reasonCode: "manifest_unknown_keys",
          message: "x uses manifest keys this version of zoto-viz doesn't recognise (foo)",
          keys: ["foo"],
        }],
      }),
    } as Response);
    await installPlugins();
    expect(manifestBlockedCatalog()[0]?.id).toBe("x");
    vi.restoreAllMocks();
  });
});
