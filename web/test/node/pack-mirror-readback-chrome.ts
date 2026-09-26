import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";

export const PACK_MIRROR_READBACK_CHROME_PATH = process.env.PACK_MIRROR_CHROME_PATH || "/usr/local/bin/google-chrome";
export const PACK_MIRROR_READBACK_CHROME_VERSION = "148.0.7778.96";

function chromeVersion(): string {
  const out = execFileSync(PACK_MIRROR_READBACK_CHROME_PATH, ["--version"], { encoding: "utf8" }).trim();
  const m = out.match(/(\d+\.\d+\.\d+\.\d+)/);
  return m?.[1] ?? out;
}

/** Fail during collection when Chrome for Testing is missing or wrong version. */
export function requireReadbackChrome(): void {
  try {
    accessSync(PACK_MIRROR_READBACK_CHROME_PATH, constants.X_OK);
  } catch {
    throw new Error(
      `Chrome for Testing is required at ${PACK_MIRROR_READBACK_CHROME_PATH} (readback must fail, not skip)`,
    );
  }
  const ver = chromeVersion();
  if (ver !== PACK_MIRROR_READBACK_CHROME_VERSION) {
    throw new Error(`Expected Chrome for Testing ${PACK_MIRROR_READBACK_CHROME_VERSION}, got ${ver}`);
  }
}
