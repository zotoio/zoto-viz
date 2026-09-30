/**
 * #169: packs the service kept in the catalog but can't load (payload `unavailable`).
 *
 * - `esbuild_unavailable`: setup isn't finished (esbuild / web/node_modules missing on the server).
 * - `bundle_failed`: this one pack's frontend couldn't be built; the rest still load.
 *
 * They are never plugin modes, so the automatic picks (wall fill, apply-mode fallback, dogfood)
 * skip them without a word. The places a person looks keep them visible: the header picker lists
 * each one greyed out and unpickable, with one setup banner per catalog, and a saved tile that
 * points at one keeps its slot and shows the notice. User text never carries a path, rule id or
 * raw error; those stay in the server log.
 */
import { parsePluginId } from "./instances";

export const UNAVAILABLE_ESBUILD = "esbuild_unavailable";
export const UNAVAILABLE_BUNDLE_FAILED = "bundle_failed";

export type UnavailablePack = {
  id: string;
  name: string;
  reason: string;
};

/** Picker value prefix for a greyed-out row; never a mode id, so nothing can apply it. */
export const UNAVAILABLE_VIEW_PREFIX = "__unavailable__:";

/**
 * Ending of the setup sentences. "reload": `pnpm install` changes web/node_modules/esbuild, which is
 * part of the catalog memo token (service/plugins.py `_esbuild_probe`), and failed bundles are never
 * cached, so the next GET /api/plugins rebuilds them. Pinned by
 * tests/test_plugins_esbuild_unavailable.py::test_reload_after_pnpm_install_recovers_without_restart.
 */
export const SETUP_FIX = "Run `pnpm install` in `web/` on the server, then reload.";

let catalog: UnavailablePack[] = [];

function toUnavailable(raw: unknown): UnavailablePack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : id;
  const reason = o.reason === UNAVAILABLE_BUNDLE_FAILED ? UNAVAILABLE_BUNDLE_FAILED : UNAVAILABLE_ESBUILD;
  return { id, name, reason };
}

/** Store this catalog's unavailable rows (replaces the last catalog's). */
export function setUnavailableCatalog(rows: readonly unknown[] | null | undefined): void {
  const seen = new Set<string>();
  catalog = [];
  for (const raw of rows ?? []) {
    const row = toUnavailable(raw);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    catalog.push(row);
  }
}

export function unavailableCatalog(): readonly UnavailablePack[] {
  return catalog;
}

/** A catalog row the service marked `available: false` (never a plugin mode). */
export function isUnavailableRow(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as { available?: unknown }).available === false;
}

/** The unavailable pack a view / tile id points at (`plugin:<id>`, `plugin:<id>!2`, instances), or null. */
export function unavailablePackForView(viewId: string | null | undefined): UnavailablePack | null {
  if (!viewId) return null;
  const pid = viewId.startsWith(UNAVAILABLE_VIEW_PREFIX)
    ? viewId.slice(UNAVAILABLE_VIEW_PREFIX.length)
    : parsePluginId(viewId);
  if (!pid) return null;
  return catalog.find((p) => p.id === pid) ?? null;
}

/** Picker row label. */
export function unavailablePickerLabel(p: UnavailablePack): string {
  return p.reason === UNAVAILABLE_BUNDLE_FAILED
    ? `${p.name} couldn't be prepared, so it isn't available. Check the server log for details.`
    : `${p.name} can't load until setup is finished.`;
}

/** Notice on a saved tile that points at an unavailable pack (never a blank tile). */
export function unavailableTileNotice(p: UnavailablePack): string {
  return p.reason === UNAVAILABLE_BUNDLE_FAILED
    ? unavailablePickerLabel(p)
    : `${p.name} can't load until setup is finished. ${SETUP_FIX}`;
}

/** One banner per catalog for the setup case, or null. Bundle failures are per pack, not a banner. */
export function unavailableBanner(rows: readonly UnavailablePack[] = catalog): string | null {
  const n = rows.filter((p) => p.reason === UNAVAILABLE_ESBUILD).length;
  if (!n) return null;
  return n === 1
    ? `1 pack can't load until setup is finished. ${SETUP_FIX}`
    : `${n} packs can't load until setup is finished. ${SETUP_FIX}`;
}

export type UnavailablePickerRow = {
  value: string;
  label: string;
  hint: string;
  group: string;
  disabled: true;
};

export const UNAVAILABLE_GROUP = "unavailable";

/** Greyed-out picker rows, after every available row. */
export function unavailablePickerRows(rows: readonly UnavailablePack[] = catalog): UnavailablePickerRow[] {
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      value: `${UNAVAILABLE_VIEW_PREFIX}${p.id}`,
      label: unavailablePickerLabel(p),
      hint: "",
      group: UNAVAILABLE_GROUP,
      disabled: true as const,
    }));
}

export function resetUnavailableCatalogForTests(): void {
  catalog = [];
}
