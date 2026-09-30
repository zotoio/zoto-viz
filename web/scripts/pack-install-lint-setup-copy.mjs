/**
 * #186: the install-lint setup-refusal sentence, rendered from the one table,
 * pack-install-lint-setup-copy.json (next to this file). service/pack_install_lint.py reads the same
 * file and renders it the same way: one pass over {name} / {fix} / {still} / {old}, so a pack name or
 * version that contains a placeholder is never expanded. bundle-pack-entry.mjs only renders the
 * fresh-install sentence; the upgrade sentence is the service's (it knows the installed version).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SETUP_COPY_FILE = "pack-install-lint-setup-copy.json";
const here = path.dirname(fileURLToPath(import.meta.url));

/** The table, read fresh (sync): throws if it's missing or not JSON; the caller fails closed. */
export function loadSetupCopy() {
  return JSON.parse(fs.readFileSync(path.join(here, SETUP_COPY_FILE), "utf8"));
}

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, key) => (Object.hasOwn(values, key) ? values[key] : m));
}

/** The fix sentence for a reason code ("" or an unlisted code: the table's default). */
export function setupFix(reason, copy = loadSetupCopy()) {
  const key = Object.hasOwn(copy.reasons, reason ?? "") ? copy.reasons[reason] : copy.default;
  const fix = copy.fixes[key];
  if (typeof fix !== "string") throw new Error(`setup copy: no fix "${key}" for reason "${reason}"`);
  return fix;
}

/** The table's `kind` template ("install" / "upgrade") for a reason: its `overrides` entry, else the shared one. */
export function setupTemplate(kind, reason, copy = loadSetupCopy()) {
  const own = Object.hasOwn(copy.overrides ?? {}, reason ?? "") ? copy.overrides[reason] : null;
  return own && typeof own[kind] === "string" ? own[kind] : copy[kind];
}

/** The fresh-install sentence (the reason's `install` template) with this reason's fix. */
export function setupSentence(name, reason, copy = loadSetupCopy()) {
  const label = String(name ?? "").trim() || "Plugin";
  return fill(setupTemplate("install", reason, copy), { name: label, fix: setupFix(reason, copy) });
}
