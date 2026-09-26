import { readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const brands = [
  "CssRect",
  "DeviceRect",
  "GlRect",
  "CanvasDeviceHeight",
  "FrameTs",
  "MonoMs",
  "WallMs",
  "EpochSec",
];

const mintFiles = new Set([
  "src/graph/pack-mirror-rect.ts",
  "src/core/time-brands.ts",
]);

const pattern = new RegExp(`\\sas\\s+(${brands.join("|")})\\b`, "g");

let failed = false;
for (const file of globSync("src/**/*.ts", { cwd: root })) {
  if (file.endsWith(".test.ts") || mintFiles.has(file)) continue;
  const text = readFileSync(`${root}/${file}`, "utf8");
  for (const match of text.matchAll(pattern)) {
    console.error(`${file}: brand cast \`as ${match[1]}\` (only mint modules and *.test.ts)`);
    failed = true;
  }
}

if (failed) process.exit(1);
