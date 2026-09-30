import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePackBundleImport } from "../../../plugins/sdk/pack-bundle-resolve.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sdkRoot = path.join(repoRoot, "plugins/sdk");
const bundleScript = path.join(repoRoot, "web/scripts/bundle-pack-entry.mjs");

function fixtureHome(name: string): string {
  return path.join(repoRoot, "plugins/sdk/pack-bundle-fixtures", name);
}

function bundlePack(home: string): { ok: true; js: string } | { ok: false; stderr: string } {
  const entry = path.join(home, "frontend/index.ts");
  try {
    const js = execFileSync("node", [bundleScript, entry, sdkRoot, home, repoRoot], { encoding: "utf8" });
    return { ok: true, js };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    return { ok: false, stderr: String(err.stderr || err.stdout || e) };
  }
}

describe("pack bundle resolver", () => {
  it("rejects sdk-shaped traversal into web/src", () => {
    const home = fixtureHome("host-escape");
    const importer = path.join(home, "frontend/index.ts");
    const spec = "../../../sdk/../../../web/src/plugins/host";
    const r = resolvePackBundleImport({
      specifier: spec,
      importerFile: importer,
      packHome: home,
      sdkRoot,
      repoRoot,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("outside-boundary");
    const built = bundlePack(home);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.stderr).toContain("pack-bundle-boundary");
  });

  it("allows a pack-local sdk/ folder (not repo plugins/sdk)", () => {
    const home = fixtureHome("local-sdk");
    const importer = path.join(home, "frontend/index.ts");
    const r = resolvePackBundleImport({
      specifier: "./sdk/marker",
      importerFile: importer,
      packHome: home,
      sdkRoot,
      repoRoot,
    });
    expect(r.ok).toBe(true);
    if (r.ok && !("external" in r)) expect(r.zone).toBe("pack");
    const built = bundlePack(home);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.js).toContain("pack-local-sdk");
  });

  it("rejects json outside pack and sdk", () => {
    const home = fixtureHome("json-escape");
    const built = bundlePack(home);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.stderr).toContain("pack-bundle-boundary");
  });
});
