import { readFileSync, globSync } from "node:fs";

const brands = [
  "CssRect",
  "DeviceRect",
  "GlRect",
  "CanvasDeviceHeight",
  "DevicePxRatio",
  "FrameTs",
  "MonoMs",
  "WallMs",
  "EpochSec",
];

const mintFiles = new Set([
  "src/graph/pack-mirror-rect.ts",
  "src/graph/render-host-device-px-ratio.ts",
]);

const devicePxRatioMint = "src/graph/render-host-device-px-ratio.ts";

const castPattern = new RegExp(`\\sas\\s+(${brands.join("|")})\\b`, "g");
const devicePxRatioReadPattern = /\bdevicePixelRatio\b/g;

/** @typedef {{ file: string, rule: string, line: number, col: number }} LintViolation */

function indexToLineCol(text, index) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const col = index - (lastNl < 0 ? -1 : lastNl);
  return { line, col };
}

/**
 * @param {string} file relative path under web/
 * @param {string} text
 * @param {{ brandCasts?: boolean, devicePxRatioReads?: boolean }} options
 * @returns {LintViolation[]}
 */
export function lintSourceText(file, text, options = {}) {
  const brandCasts = options.brandCasts ?? true;
  const devicePxRatioReads = options.devicePxRatioReads ?? true;
  const violations = [];

  if (file.endsWith(".test.ts") || mintFiles.has(file)) {
    return violations;
  }

  if (brandCasts) {
    for (const match of text.matchAll(castPattern)) {
      const { line, col } = indexToLineCol(text, match.index ?? 0);
      violations.push({ file, rule: "brand-cast", line, col });
    }
  }

  if (devicePxRatioReads && file !== devicePxRatioMint) {
    for (const match of text.matchAll(devicePxRatioReadPattern)) {
      const { line, col } = indexToLineCol(text, match.index ?? 0);
      violations.push({ file, rule: "device-px-ratio-read", line, col });
      break;
    }
  }

  return violations;
}

/**
 * @param {string} webRoot absolute path to web/
 * @param {{ brandCasts?: boolean, devicePxRatioReads?: boolean }} options
 * @returns {LintViolation[]}
 */
export function lintProductionTree(webRoot, options = {}) {
  const violations = [];
  for (const file of globSync("src/**/*.ts", { cwd: webRoot })) {
    const text = readFileSync(`${webRoot}/${file}`, "utf8");
    violations.push(...lintSourceText(file, text, options));
  }
  return violations;
}

export function formatViolation({ file, rule, line, col }) {
  return `${file}:${line}:${col}: ${rule}`;
}
