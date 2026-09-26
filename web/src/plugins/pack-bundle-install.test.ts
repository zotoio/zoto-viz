import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatPackInstallBlocked, isPackInstallBlockedPayload } from "./pack-install-surface";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function pythonDepsReady(): boolean {
  try {
    execFileSync("python3", ["-c", "from service import plugin_local"], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: repoRoot },
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function packTreeToZip(packDir: string): string {
  const out = execFileSync(
    "python3",
    [
      "-c",
      `
import tempfile
from pathlib import Path
from service import plugin_zip as pz
src = Path(${JSON.stringify(packDir)})
fd, name = tempfile.mkstemp(suffix=".zip")
import os; os.close(fd)
pz.pack_tree(src, Path(name))
print(name)
`,
    ],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, PYTHONPATH: repoRoot } },
  ).trim();
  return out;
}

function tryInstallLocalZip(zipPath: string, pluginLocalDir: string): Record<string, unknown> {
  const raw = readFileSync(zipPath);
  const script = `
import os, base64
from pathlib import Path
from service import plugin_local, plugins, paths
from service.pack_boundary import PackBundleBoundaryError
from service.plugin_install import InstallV2BlockedError

os.environ["ZOTO_VIZ_PLUGIN_LOCAL"] = ${JSON.stringify(pluginLocalDir)}
plugins.reset_bundles()
raw = base64.b64decode(${JSON.stringify(raw.toString("base64"))})
mode_before = None
try:
    from service import live
    live.reset_for_tests()
    snap = live.snapshot()
    mode_before = snap.get("patch", {}).get("mode")
except Exception:
    pass
try:
    info = plugin_local.install_local_zip(raw, activate=True)
except PackBundleBoundaryError as e:
    info = {"ok": False, **e.block.to_dict()}
except InstallV2BlockedError as e:
    info = {"ok": False, "error": "pack_install_blocked", "message": str(e)}
except Exception as e:
    info = {"ok": False, "error": str(e)}
scan = plugins.scan()
ids = [p["id"] for p in scan.get("plugins") or []]
import json
print(json.dumps({"info": info, "ids": ids, "mode_before": mode_before}))
`;
  return JSON.parse(
    execFileSync("python3", ["-c", script], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ZOTO_VIZ_PLUGIN_LOCAL: pluginLocalDir, PYTHONPATH: repoRoot },
    }),
  ) as { info: Record<string, unknown>; ids: string[] };
}

describe.skipIf(!pythonDepsReady())("pack bundle install gate (local zip path)", () => {
  const fixtures = [
    { dir: "host-escape", id: "pack-boundary-host-escape" },
    { dir: "json-escape", id: "pack-boundary-json-escape" },
  ] as const;

  for (const { dir, id } of fixtures) {
    it(`blocks ${dir} through install_local_zip`, () => {
      const pluginLocalDir = mkdtempSync(path.join(os.tmpdir(), "zoto-pack-boundary-"));
      try {
        const packDir = path.join(repoRoot, "plugins/sdk/pack-bundle-fixtures", dir);
        const zipPath = packTreeToZip(packDir);
        const { info, ids } = tryInstallLocalZip(zipPath, pluginLocalDir);
        expect(info.ok).toBe(false);
        expect(isPackInstallBlockedPayload(info)).toBe(true);
        const message = formatPackInstallBlocked(info);
        expect(message).toMatch(/was blocked|v1 is still running/);
        expect(message).not.toContain("plugins/src/pack-boundary");
        expect(ids).not.toContain(id);
        const runtime = path.join(pluginLocalDir, ".runtime", id);
        expect(existsSync(runtime)).toBe(false);
      } finally {
        rmSync(pluginLocalDir, { recursive: true, force: true });
      }
    });
  }
});
