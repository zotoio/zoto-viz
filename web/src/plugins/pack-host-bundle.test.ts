import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import { PluginSandbox } from "./host";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bundleScript = path.join(repoRoot, "web/scripts/bundle-pack-entry.mjs");
const sdkRoot = path.join(repoRoot, "plugins/sdk");

function bundlePackEntry(entryTs: string, packHome: string): string {
  return execFileSync(
    "node",
    [bundleScript, entryTs, sdkRoot, packHome, repoRoot],
    { encoding: "utf8" },
  );
}

function stubZoto(): VizZoto {
  return {
    onTick: null,
    onConfig: null,
    onFrame: null,
    writeBuffer: () => {},
    writeUniform: () => {},
    writeParticles: () => {},
    getConfig: () => ({}),
  };
}

describe.skipIf(!existsSync(bundleScript))("pack module host wrapper", () => {
  const boxes: PluginSandbox[] = [];

  afterEach(() => {
    for (const box of boxes) boxes.pop()?.unload();
  });

  it("host srcdoc no longer injects const zoto ahead of the pack module", async () => {
    const box = new PluginSandbox();
    boxes.push(box);
    await box.load("probe", "globalThis.__probe = 1;", ["viz.write"], {});
    const srcdoc = document.querySelector("iframe")?.srcdoc ?? "";
    expect(srcdoc).not.toMatch(/const zoto = globalThis\.zoto/);
    expect(srcdoc).toMatch(/<script type="module">/);
  });

  it("runs esbuild output that uses getVizZoto without Identifier clash", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "zoto-pack-host-wrap-"));
    try {
      const packHome = path.join(tmp, "pack");
      const entryDir = path.join(packHome, "frontend");
      mkdirSync(entryDir, { recursive: true });
      writeFileSync(
        path.join(entryDir, "index.ts"),
        `import { getVizZoto } from "../../../sdk/viz-zoto";
const host = getVizZoto();
(globalThis as unknown as { __packHostOk?: boolean }).__packHostOk = true;
host.onFrame = () => {};
`,
      );
      const entry = path.join(entryDir, "index.ts");
      const bundled = bundlePackEntry(entry, packHome);
      expect(bundled).toContain("getVizZoto");
      expect(bundled).not.toMatch(/\b(?:const|let|var)\s+zoto\b/);

      (globalThis as unknown as { zoto: VizZoto }).zoto = stubZoto();
      const dataUrl = `data:text/javascript;base64,${Buffer.from(bundled, "utf8").toString("base64")}`;
      await import(dataUrl);
      expect((globalThis as unknown as { __packHostOk?: boolean }).__packHostOk).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      delete (globalThis as unknown as { __packHostOk?: boolean }).__packHostOk;
    }
  });

  it("legacy host prefix const zoto clashes with pack var zoto", () => {
    const legacyWrap = (body: string) => `const zoto = globalThis.zoto; ${body}`;
    expect(() => {
      // eslint-disable-next-line no-new-func
      new Function(legacyWrap("var zoto = 1;"))();
    }).toThrow(/zoto/);
    expect(() => {
      // eslint-disable-next-line no-new-func
      new Function("var zoto = 1;")();
    }).not.toThrow();
  });
});
