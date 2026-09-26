#!/usr/bin/env node
/**
 * Bundle a pack frontend entry for the service catalog.
 * Every resolved file must stay inside the pack home or plugins/sdk (realpath).
 */
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  PACK_BUNDLE_EXTERNALS,
  resolvePackBundleImport,
} from "../../plugins/sdk/pack-bundle-resolve.mjs";

const entry = process.argv[2];
const sdkRoot = path.resolve(process.argv[3] ?? "");
const packHome = path.resolve(process.argv[4] ?? "");
const repoRoot = process.argv[5] ? path.resolve(process.argv[5]) : undefined;

if (!entry || !sdkRoot || !packHome) {
  console.error("usage: bundle-pack-entry.mjs <entry.ts> <plugins/sdk/abs> <packHome/abs> [repoRoot]");
  process.exit(2);
}

if (repoRoot && process.env.ZOTO_PACK_INSTALL_LINT === "1") {
  const tsxCli = path.join(repoRoot, "web/node_modules/tsx/dist/cli.mjs");
  const lintRun = path.join(repoRoot, "web/scripts/pack-install-lint-run.ts");
  if (fs.existsSync(tsxCli) && fs.existsSync(lintRun)) {
    const lint = spawnSync(process.execPath, [tsxCli, lintRun, packHome, repoRoot], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (lint.stderr) process.stderr.write(lint.stderr);
    if (lint.status !== 0) {
      process.exit(lint.status === null ? 1 : lint.status);
    }
  }
}

function boundaryError(importer, specifier, reason) {
  const relFile = path.relative(packHome, importer).replace(/\\/g, "/");
  const payload = {
    type: "pack-bundle-boundary",
    file: relFile.startsWith("..") ? path.basename(importer) : relFile,
    import: specifier,
    reason,
  };
  return { errors: [{ text: JSON.stringify(payload) }] };
}

const nodeEnv = process.env.NODE_ENV === "production" ? "production" : "development";

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: {
    "process.env.NODE_ENV": JSON.stringify(nodeEnv),
  },
  external: [...PACK_BUNDLE_EXTERNALS],
  plugins: [
    {
      name: "zoto-pack-boundary",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.startsWith("\0")) return null;
          if (args.kind === "entry-point") return null;
          const resolved = resolvePackBundleImport({
            specifier: args.path,
            importerFile: args.importer,
            packHome,
            sdkRoot,
            repoRoot,
          });
          if (resolved.ok && resolved.external) {
            return { path: args.path, external: true };
          }
          if (!resolved.ok) {
            return boundaryError(args.importer, args.path, resolved.reason);
          }
          return { path: resolved.path };
        });
      },
    },
  ],
  write: false,
  logLevel: "silent",
}).catch((err) => {
  const msgs = err?.errors?.map((e) => e.text).filter(Boolean) ?? [];
  const boundary = msgs.find((t) => t.includes("pack-bundle-boundary"));
  if (boundary) {
    console.error(boundary);
  } else {
    console.error(String(err?.message || err));
  }
  process.exit(1);
});

if (!result.outputFiles[0]) {
  console.error("esbuild produced no output");
  process.exit(1);
}
process.stdout.write(result.outputFiles[0].text);
