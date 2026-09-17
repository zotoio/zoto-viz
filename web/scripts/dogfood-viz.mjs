#!/usr/bin/env node
/**
 * Live FPS dogfood runner — prints fat-LAN soak numbers for CI / PR bodies.
 * Runs via vitest so TypeScript modules resolve without a separate bundler.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "src/plugins/dogfood.test.ts", "-t", "fat-LAN live soak"],
  { cwd: webRoot, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } },
);
process.exit(result.status ?? 1);
