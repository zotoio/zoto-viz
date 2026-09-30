#!/usr/bin/env node
/**
 * Bundle a pack frontend entry for the service catalog.
 * Every resolved file must stay inside the pack home or plugins/sdk (realpath).
 *
 *   bundle-pack-entry.mjs <entry.ts> <plugins/sdk/abs> <packHome/abs> [repoRoot]
 *   bundle-pack-entry.mjs --lint-only <packHome/abs> <repoRoot>
 *
 * Install lint (#185) runs with ZOTO_PACK_INSTALL_LINT=1 (bundle mode) or --lint-only (packs that
 * aren't bundled: `frontend.bundle: false` or no frontend). #186: it runs in this process, from the
 * prebuilt plain-JS pack-install-lint.built.mjs (no TypeScript runner); its verdict is a return
 * value. --lint-only also runs esbuild's import-boundary check over the unbundled scripts. It fails
 * closed. Exit codes: 0 pass, 1 lint block / boundary block / build error, 2 usage, 3 setup refusal
 * (the check couldn't run: esbuild, plugins/sdk or the built lint missing, a built lint that doesn't
 * match its sources, or a lint that threw or gave no verdict; the user message never carries the
 * raw cause, only the `pack-install-lint-setup-error` diagnostic line does). On a pass the LAST
 * stderr line is {"type":"pack-install-lint-pass","nonce":$ZOTO_PACK_INSTALL_LINT_NONCE,"pack":<id>},
 * which the service requires.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXIT_LINT_BLOCK = 1;
const EXIT_LINT_SETUP = 3;
const LINT_SETUP = "pack-install-lint-setup-error";
const LINT_PASS = "pack-install-lint-pass";
const LINT_BLOCK = "pack-install-lint-block";
/** The checkout this script (and its built lint) belongs to: the built lint's sources are here. */
const scriptRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const flags = new Map();
const pos = [];
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    flags.set(eq < 0 ? arg.slice(2) : arg.slice(2, eq), eq < 0 ? "" : arg.slice(eq + 1));
  } else {
    pos.push(arg);
  }
}
const lintOnly = flags.has("lint-only");
const lintMode = lintOnly || process.env.ZOTO_PACK_INSTALL_LINT === "1";

const entry = lintOnly ? "" : pos[0];
const sdkRoot = lintOnly ? "" : path.resolve(pos[1] ?? "");
const packHome = path.resolve((lintOnly ? pos[0] : pos[2]) ?? "");
const repoArg = lintOnly ? pos[1] : pos[3];
const repoRoot = repoArg ? path.resolve(repoArg) : undefined;

if (lintOnly ? !pos[0] || !pos[1] : !entry || !pos[1] || !pos[2]) {
  console.error("usage: bundle-pack-entry.mjs <entry.ts> <plugins/sdk/abs> <packHome/abs> [repoRoot]");
  console.error("       bundle-pack-entry.mjs --lint-only <packHome/abs> <repoRoot>");
  process.exit(2);
}

function readManifest(home) {
  for (const name of ["plugin.yml", "plugin.yaml"]) {
    try {
      return fs.readFileSync(path.join(home, name), "utf8");
    } catch {
      /* try the next name */
    }
  }
  return "";
}

function manifestField(text, key) {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
  if (!m) return "";
  return m[1].replace(/^(["'])(.*)\1$/, "$2").trim();
}

const manifest = readManifest(packHome);
/** plugin.yml `id:` (the service checks it in the pass verdict), else the pack folder name. */
const packId = manifestField(manifest, "id") || path.basename(packHome);
/** plugin.yml display name (top-level `name:`), else `id:`, else the pack folder name. */
const packName = manifestField(manifest, "name") || packId;

function refuseLintSetup(detail) {
  const message = `Couldn't safety-check ${packName}, so it wasn't installed. Run \`pnpm install\` in \`web/\` and try again.`;
  console.error(message);
  console.error(JSON.stringify({ type: LINT_SETUP, message, detail }));
  process.exit(EXIT_LINT_SETUP);
}

function errCode(err) {
  return String(err?.code || err?.message || err);
}

/** The service's verdict: last stderr line, bound to the service's nonce and this pack id. */
function emitServicePass() {
  console.error(JSON.stringify({ type: LINT_PASS, nonce: process.env.ZOTO_PACK_INSTALL_LINT_NONCE ?? "", pack: packId }));
}

/** A module the bundle needs (esbuild after `pnpm install --prod`, plugins/sdk) can't load. */
async function importOrRefuse(spec, what) {
  try {
    return await import(spec);
  } catch (err) {
    if (lintMode) refuseLintSetup(`${what} not importable: ${errCode(err)}`);
    console.error(`${what} not importable (${errCode(err)}); run \`pnpm install\` in \`web/\``);
    process.exit(1);
  }
}

const esbuild = lintOnly ? null : await importOrRefuse("esbuild", "esbuild");
const bundleResolve = lintOnly
  ? null
  : await importOrRefuse("../../plugins/sdk/pack-bundle-resolve.mjs", "plugins/sdk/pack-bundle-resolve.mjs");

/**
 * #186: the install lint, in this process. The built lint is plain JS (no tsx); a missing or stale one
 * is the setup refusal, and `pnpm install` in web/ rebuilds it (web/ `prepare`), so the setup sentence
 * stays true. Only a `{kind: "pass"}` return value lets the install go ahead.
 */
async function runInstallLint() {
  if (!repoRoot) refuseLintSetup("no repo root passed to bundle-pack-entry.mjs");
  let lint;
  let stamp;
  try {
    stamp = await import("./pack-install-lint-stamp.mjs");
  } catch (err) {
    refuseLintSetup(`lint stamp check not importable: ${errCode(err)}`);
  }
  try {
    lint = await import(`./${stamp.BUILT_LINT_FILE}`);
  } catch (err) {
    refuseLintSetup(`built lint not importable: ${errCode(err)}`);
  }
  const stale = stamp.staleReason(lint.PACK_INSTALL_LINT_BUILD, scriptRepoRoot);
  if (stale) refuseLintSetup(stale);
  let verdict;
  try {
    verdict = lint.runPackInstallLint(packHome, repoRoot, { unbundled: lintOnly });
  } catch (err) {
    refuseLintSetup(`lint threw: ${errCode(err)}`);
  }
  const kind = verdict && typeof verdict === "object" ? verdict.kind : undefined;
  for (const w of Array.isArray(verdict?.warnings) ? verdict.warnings : []) console.warn(String(w));
  if (kind === "block") {
    const details = Array.isArray(verdict.details) ? verdict.details.map(String) : [];
    for (const line of details) console.error(line);
    // #185: `message` is the <sentence> in "<Name> was blocked because <sentence> …" — plain words only.
    console.error(JSON.stringify({ type: LINT_BLOCK, message: String(verdict.message || ""), details }));
    process.exit(EXIT_LINT_BLOCK);
  }
  if (kind === "boundary") {
    // #186: the same payload esbuild's boundary plugin gives the service (pack_boundary.py).
    console.error(JSON.stringify({ type: "pack-bundle-boundary", file: verdict.file, import: verdict.import, reason: verdict.reason }));
    process.exit(EXIT_LINT_BLOCK);
  }
  if (kind !== "pass") refuseLintSetup(`lint gave no verdict (${kind === undefined ? typeof verdict : JSON.stringify(kind)})`);
}

if (lintMode) await runInstallLint();

if (lintOnly) {
  emitServicePass();
  process.exit(0);
}

const { PACK_BUNDLE_EXTERNALS, resolvePackBundleImport } = bundleResolve;

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
if (lintMode) emitServicePass();
process.stdout.write(result.outputFiles[0].text);
