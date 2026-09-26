import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import type { StateMsg } from "../../core/types";
import { trimAndScrubVizCaptureState } from "./viz-sdk-frame-build";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const outState = path.join(repoRoot, "plugins/sdk/fixtures/vm-live-state.json");

describe("capture vm-live monitor state", () => {
  it.skipIf(!process.env.CAPTURE_VM_LIVE)("write scrubbed vm-live-state.json from /api/state", async () => {
    const base = process.env.ZOTO_VIZ_API ?? "http://127.0.0.1:7020";
    const soakMs = Number(process.env.CAPTURE_VM_LIVE_SOAK_MS ?? 45_000);
    await new Promise((r) => setTimeout(r, soakMs));
    const res = await fetch(`${base}/api/state`);
    if (!res.ok) throw new Error(`GET /api/state ${res.status}`);
    const raw = (await res.json()) as StateMsg;
    const trimmed = trimAndScrubVizCaptureState(raw);
    writeFileSync(outState, `${JSON.stringify(trimmed, null, 2)}\n`);
  });

  it.skipIf(!process.env.IMPORT_VM_LIVE_RAW)("import raw JSON path into vm-live-state.json", () => {
    const rawPath = process.env.IMPORT_VM_LIVE_RAW!;
    const raw = JSON.parse(readFileSync(rawPath, "utf8")) as StateMsg;
    writeFileSync(outState, `${JSON.stringify(trimAndScrubVizCaptureState(raw), null, 2)}\n`);
  });
});
