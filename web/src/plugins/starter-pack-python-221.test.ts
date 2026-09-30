/**
 * #221: the starter scan runs on the interpreter repoPython picks (ZOTO_VIZ_PYTHON, else <repo>/.venv,
 * else python3), not on whichever python3 is first on PATH. A missing service dependency names the
 * interpreter that was used and how to fix it.
 */
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repoPython, scanStarterPackCatalog, stageStarterTree, STARTER_CI_PACK_ID } from "./starter-pack-pipeline";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const starterRoot = path.join(repoRoot, "plugins/sdk/starter");
const venvPython = path.join(repoRoot, ".venv/bin/python");
const hideVenv = (): boolean => false;

describe("#221 starter scan interpreter", () => {
  it("scans on ZOTO_VIZ_PYTHON when the repo .venv is hidden from the picker", () => {
    expect(existsSync(venvPython), `needs ${venvPython} with requirements.txt installed`).toBe(true);
    expect(repoPython(repoRoot, { env: {}, exists: () => true })).toBe(venvPython);
    expect(repoPython(repoRoot, { env: {}, exists: hideVenv })).toBe("python3");
    const seams = { env: { ...process.env, ZOTO_VIZ_PYTHON: venvPython }, exists: hideVenv };
    expect(repoPython(repoRoot, seams)).toBe(venvPython);
    const { stageRoot } = stageStarterTree(starterRoot, repoRoot);
    try {
      const scan = scanStarterPackCatalog(repoRoot, stageRoot, STARTER_CI_PACK_ID, seams);
      expect(scan.errors).toEqual([]);
      expect(scan.pluginIds).toContain(STARTER_CI_PACK_ID);
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("names the interpreter and the fix when it cannot import the service deps", () => {
    // The venv's own python with -S (no site-packages): a python3 without the deps on any host.
    const dir = mkdtempSync(path.join(os.tmpdir(), "zoto-221-py-"));
    const bare = path.join(dir, "python3-without-deps");
    writeFileSync(bare, `#!/bin/sh\nexec "${venvPython}" -S "$@"\n`);
    chmodSync(bare, 0o755);
    const { stageRoot } = stageStarterTree(starterRoot, repoRoot);
    try {
      const seams = { env: { ...process.env, ZOTO_VIZ_PYTHON: bare }, exists: hideVenv };
      expect(() => scanStarterPackCatalog(repoRoot, stageRoot, STARTER_CI_PACK_ID, seams)).toThrow(
        `${bare} cannot import the zoto-viz service deps (ModuleNotFoundError: No module named`,
      );
      expect(() => scanStarterPackCatalog(repoRoot, stageRoot, STARTER_CI_PACK_ID, seams)).toThrow(
        /Create <repo>\/\.venv .* or set ZOTO_VIZ_PYTHON to an interpreter that has them/,
      );
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
