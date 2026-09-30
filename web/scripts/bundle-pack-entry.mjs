#!/usr/bin/env node
/**
 * Bundle a pack frontend entry for the service catalog.
 * Every resolved file must stay inside the pack home or plugins/sdk (realpath).
 */
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
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

/**
 * Install lint (#185): fails closed. The install goes ahead only on the runner's explicit pass
 * verdict (a `pack-install-lint-pass` JSON line on stdout, exit 0). A real lint block (exit 1 with
 * the `pack-install-lint-block` JSON line) keeps its message and exit 1. Anything else (tsx or the
 * runner can't be resolved or started, a crash, a signal, exit 0 without a verdict) refuses the
 * install with EXIT_LINT_SETUP and a `pack-install-lint-setup-error` JSON line.
 */
const EXIT_LINT_BLOCK = 1;
const EXIT_LINT_SETUP = 3;
const LINT_PASS = "pack-install-lint-pass";
const LINT_BLOCK = "pack-install-lint-block";
const LINT_SETUP = "pack-install-lint-setup-error";

function jsonLines(text, type) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const raw = JSON.parse(t);
      if (raw && typeof raw === "object" && raw.type === type) out.push(raw);
    } catch {
      /* not a verdict line */
    }
  }
  return out;
}

/** plugin.yml display name (top-level `name:`), else `id:`, else the pack folder name. */
function packDisplayName(home) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(home, "plugin.yml"), "utf8");
  } catch {
    try {
      text = fs.readFileSync(path.join(home, "plugin.yaml"), "utf8");
    } catch {
      text = "";
    }
  }
  const field = (key) => {
    const m = text.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
    if (!m) return "";
    return m[1].replace(/^(["'])(.*)\1$/, "$2").trim();
  };
  return field("name") || field("id") || path.basename(home);
}

function refuseLintSetup(detail) {
  const message = `Couldn't safety-check ${packDisplayName(packHome)}, so it wasn't installed. Run \`pnpm install\` in \`web/\` and try again.`;
  console.error(message);
  console.error(JSON.stringify({ type: LINT_SETUP, message, detail }));
  process.exit(EXIT_LINT_SETUP);
}

if (process.env.ZOTO_PACK_INSTALL_LINT === "1") {
  if (!repoRoot) refuseLintSetup("no repo root passed to bundle-pack-entry.mjs");
  const lintRun = path.join(repoRoot, "web/scripts/pack-install-lint-run.ts");
  let tsxCli;
  try {
    tsxCli = createRequire(path.join(repoRoot, "web/package.json")).resolve("tsx/cli");
  } catch (err) {
    refuseLintSetup(`tsx not resolvable from web/: ${String(err?.code || err?.message || err)}`);
  }
  if (!fs.existsSync(lintRun)) refuseLintSetup(`lint runner missing: ${lintRun}`);
  const lint = spawnSync(process.execPath, [tsxCli, lintRun, packHome, repoRoot], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (lint.stderr) process.stderr.write(lint.stderr);
  if (lint.error) refuseLintSetup(`lint runner did not start: ${String(lint.error.code || lint.error.message)}`);
  if (lint.signal) refuseLintSetup(`lint runner killed by ${lint.signal}`);
  if (lint.status === EXIT_LINT_BLOCK && jsonLines(lint.stderr, LINT_BLOCK).length > 0) {
    process.exit(EXIT_LINT_BLOCK);
  }
  if (lint.status !== 0 || jsonLines(lint.stdout, LINT_PASS).length === 0) {
    refuseLintSetup(`lint runner gave no verdict (exit ${lint.status})`);
  }
  // Passed: tell the service the lint really ran (it refuses an install-lint bundle without this).
  console.error(JSON.stringify({ type: LINT_PASS }));
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
