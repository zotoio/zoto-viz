/**
 * #111: the web side of the one install-copy table, web/scripts/pack-install-lint-setup-copy.json. The
 * service renders the same file (service/pack_install_lint.py); neither side keeps a copy of the words.
 * One pass over the placeholders, like the service's `_fill`: a placeholder inside a value (a pack name
 * such as "Pack {still}") is never expanded.
 */
import table from "../../scripts/pack-install-lint-setup-copy.json";

export type PackUpdateCopyKind = keyof typeof table.updates;

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (Object.hasOwn(values, key) ? values[key] ?? m : m));
}

function label(name: string | undefined): string {
  return (name ?? "").trim() || "Plugin";
}

function version(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** "You're still on version <old>." or, with no known old version, "The version you had is still installed." */
export function stillSentence(oldVersion?: string | number | null): string {
  const old = version(oldVersion);
  return old ? fill(table.still, { old }) : table.still_unknown;
}

/** The table's `updates[kind]` sentence: the new version by number, then which version is still installed. */
export function packUpdateCopy(
  kind: PackUpdateCopyKind,
  name: string | undefined,
  newVersion: string | number | null | undefined,
  oldVersion?: string | number | null,
): string {
  return fill(table.updates[kind], { name: label(name), new: version(newVersion), still: stillSentence(oldVersion) });
}
