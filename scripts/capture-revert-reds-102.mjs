#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVitestJsonReport, vitestTestNamePattern } from "./revert-proof-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const bin = path.join(web, "node_modules", ".bin", "vitest");
const overlay = path.join(root, "scripts/revert-proof-vitest-overlay.mjs");
const base = path.join(web, "vitest.config.mjs");

const rows = [
  ["mosaic-pane-ids-view-change-swap", "web/src/graph/mosaic-layout.test.ts", "close / swap / assign > mosaicPaneIdsWithViewChange lists replaced and swapped panes only", "Revert swap detection in mosaicPaneIdsWithViewChange index loop"],
  ["mosaic-pane-notice-needs-review", "web/src/graph/mosaic-pane-notice.test.ts", "mosaic pane notice > shows and clears inline copy on a tile", "Revert setPaneNotice paint hook so inline needs review copy never appears"],
  ["mosaic-pane-notice-fail-start", "web/src/graph/mosaic-pane-notice.test.ts", "mosaic pane notice > shows and clears inline copy on a tile", "Revert fail styling for Blob Mesh couldn't start sandbox copy"],
  ["mosaic-viz-feed-ubo", "web/src/graph/mosaic-viz-feed.test.ts", "deliverMosaicDemoPacks > writes UBO to each tile's scene", "Revert per-tile host pack frame delivery writing UBO buffers"],
  ["mosaic-on-pane-pick-hook", "web/src/graph/mosaic-viz-feed.test.ts", "mosaic onPanePick wiring > invokes live hook instead of bare setPaneView", "Revert mosaic tile picker onPanePick live hook wiring"],
  ["viz-drive-note-host-direct", "web/src/plugins/viz-drive.test.ts", "viz-drive per tile > starts none until host-direct is noted", "Revert noteHostDirect setting dataset vizDrive to host-direct"],
  ["viz-drive-clear", "web/src/plugins/viz-drive.test.ts", "viz-drive per tile > returns to none when the pack is cleared", "Revert clearVizDrive resetting tile dataset vizDrive to none"],
  ["settings-mosaic-pick-live", "web/src/ui/settings-mosaic-pick.test.ts", "settings mosaic pane pickers > delegates slot changes to the live wall hook and reverts on failure", "Revert settings mosaic slot delegating to onMosaicPanePick live hook"],
  ["settings-mosaic-pick-deny-revert", "web/src/ui/settings-mosaic-pick.test.ts", "settings mosaic pane pickers > reverts the dropdown when the live hook denies consent", "Revert async consent denial reverting settings mosaic slot dropdown"],
  ["settings-mosaic-pick-persist", "web/src/ui/settings-mosaic-pick.test.ts", "settings mosaic pane pickers > persists mosaicTiles after a slot change when no live hook is wired", "Revert local mosaicTiles persistence when no live hook is wired"],
  ["assign-views-selective-refresh", "web/src/graph/mosaic-assign-view-sky.test.ts", "assignViews selective sky hold > setPaneView on one tile refreshes only touched pane modes", "Revert selective refreshPaneModes touch set in assignViews"],
];

function resetTree() {
  const prod = [
    "web/src/graph/mosaic.ts",
    "web/src/graph/mosaic-layout.ts",
    "web/src/graph/mosaic-viz-feed.ts",
    "web/src/plugins/viz-drive.ts",
    "web/src/ui/settings.ts",
  ];
  spawnSync("git", ["checkout", "--", ...prod], { cwd: root, encoding: "utf8" });
}

function runRow(slug, testFile, testName) {
  const patch = path.join(root, "revert-proofs/102", `${slug}.patch`);
  const ap = spawnSync("git", ["apply", patch], { cwd: root, encoding: "utf8" });
  if (ap.status !== 0) {
    return { error: ap.stderr || ap.stdout };
  }
  const jsonOut = path.join("/tmp", `rp102-${slug}.json`);
  const testFileArg = path.relative(web, path.join(root, testFile)).replace(/\\/g, "/");
  const args = [
    "run",
    "--config",
    path.relative(web, overlay),
    "-t",
    vitestTestNamePattern(testName),
    "--reporter=json",
    `--outputFile.json=${jsonOut}`,
    testFileArg,
  ];
  spawnSync(bin, args, {
    cwd: web,
    encoding: "utf8",
    env: {
      ...process.env,
      REVERT_PROOF_ROOT: root,
      REVERT_PROOF_VITEST_BASE_CONFIG: base,
    },
  });
  spawnSync("git", ["apply", "-R", patch], { cwd: root, encoding: "utf8" });
  if (!fs.existsSync(jsonOut)) return { error: "no json report" };
  const parsed = parseVitestJsonReport(JSON.parse(fs.readFileSync(jsonOut, "utf8")));
  const t = parsed.tests.find((x) => x.fullName === testName);
  return { red: t?.revertProofRed, status: t?.status, failure: t?.failureMessage };
}

resetTree();
for (const [slug, testFile, testName, desc] of rows) {
  resetTree();
  const result = runRow(slug, testFile, testName);
  const meta = {
    runner: "vitest",
    testFile: testFile.replace(/^web\//, ""),
    testName,
    description: desc,
    red: result.red ?? { actual: null, expected: null },
  };
  if (result.error) meta.captureError = result.error;
  if (result.status) meta.captureStatus = result.status;
  fs.writeFileSync(
    path.join(root, "revert-proofs/102", `${slug}.json`),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  console.log(slug, result.red ?? result.error ?? result.status);
}
