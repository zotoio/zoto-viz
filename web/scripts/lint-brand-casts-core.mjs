// @ts-check
// #192: type-checked through JSDoc (web/tsconfig.test.json includes this file; allowJs, checkJs off).
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  "src/core/time-ms.ts",
  "src/core/viz-time.ts",
  "src/graph/pack-mirror-rect.ts",
  "src/graph/render-host-device-px-ratio.ts",
  "src/plugins/nixie-wall-parts.ts",
]);

const devicePxRatioMint = "src/graph/render-host-device-px-ratio.ts";

const castPattern = new RegExp(`\\sas\\s+(${brands.join("|")})\\b`, "g");
const devicePxRatioReadPattern = /\bdevicePixelRatio\b/g;

/** @typedef {{ file: string, rule: string, line: number, col: number }} LintViolation */
/** @typedef {{ brandCasts?: boolean, devicePxRatioReads?: boolean }} LintOptions */

/**
 * @param {string} text
 * @param {number} index
 * @returns {{ line: number, col: number }}
 */
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
 * @param {LintOptions} [options]
 * @returns {LintViolation[]}
 */
export function lintSourceText(file, text, options = {}) {
  const brandCasts = options.brandCasts ?? true;
  const devicePxRatioReads = options.devicePxRatioReads ?? true;
  /** @type {LintViolation[]} */
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
 * @param {LintOptions} [options]
 * @returns {LintViolation[]}
 */
export function lintProductionTree(webRoot, options = {}) {
  /** @type {LintViolation[]} */
  const violations = [];
  for (const file of globSync("src/**/*.ts", { cwd: webRoot })) {
    const text = readFileSync(`${webRoot}/${file}`, "utf8");
    violations.push(...lintSourceText(file, text, options));
  }
  return violations;
}

/**
 * @param {LintViolation} violation
 * @returns {string}
 */
export function formatViolation({ file, rule, line, col }) {
  return `${file}:${line}:${col}: ${rule}`;
}

const invokedAsCli =
  !!process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsCli) {
  const webRoot = fileURLToPath(new URL("..", import.meta.url));
  const violations = lintProductionTree(webRoot);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(formatViolation(v));
    }
    process.exit(1);
  }
}
