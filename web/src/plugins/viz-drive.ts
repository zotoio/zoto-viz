import { noteSandboxPackWrite } from "./plugin-pack-feed";

/** Which path applies viz pack writes for a tile (QE / visible runs). */
export type VizDrive = "sandbox" | "host-direct" | "none";

type TileRow = {
  el: HTMLElement | null;
  drive: VizDrive;
  sandboxWrote: boolean;
};

const tiles = new Map<string, TileRow>();
let sandboxReady = false;

type VizDebugRoot = { tiles: Record<string, { vizDrive: VizDrive }> };

function debugRoot(): VizDebugRoot {
  const w = window as unknown as { __vizDebug?: VizDebugRoot };
  if (!w.__vizDebug) w.__vizDebug = { tiles: {} };
  return w.__vizDebug;
}

function applyDrive(tileId: string, next: VizDrive): void {
  const row = tiles.get(tileId);
  if (!row || row.drive === next) return;
  row.drive = next;
  if (row.el) row.el.dataset.vizDrive = next;
  debugRoot().tiles[tileId] = { vizDrive: next };
}

function recomputeSandbox(tileId: string): void {
  const row = tiles.get(tileId);
  if (!row || row.drive === "host-direct") return;
  const next: VizDrive = sandboxReady && row.sandboxWrote ? "sandbox" : "none";
  applyDrive(tileId, next);
}

/** Attach or refresh the DOM node for a tile id (`main` or mosaic mode id). */
export function bindVizDriveElement(tileId: string, el: HTMLElement | null): void {
  let row = tiles.get(tileId);
  if (!row) {
    row = { el: null, drive: "none", sandboxWrote: false };
    tiles.set(tileId, row);
  }
  row.el = el;
  if (el) el.dataset.vizDrive = row.drive;
  else if (row.drive !== "none") applyDrive(tileId, "none");
}

export function setSandboxReady(ready: boolean): void {
  if (sandboxReady === ready) return;
  sandboxReady = ready;
  if (!ready) {
    for (const id of tiles.keys()) {
      const row = tiles.get(id)!;
      if (row.sandboxWrote) {
        row.sandboxWrote = false;
        if (row.drive !== "host-direct") applyDrive(id, "none");
      }
    }
    return;
  }
  for (const id of tiles.keys()) recomputeSandbox(id);
}

/** Sandbox iframe sent `ready` and this tile received a plugin write. */
export function noteSandboxWrite(tileId: string): void {
  const row = tiles.get(tileId);
  if (!row) return;
  noteSandboxPackWrite(tileId);
  if (!row.sandboxWrote) {
    row.sandboxWrote = true;
    recomputeSandbox(tileId);
  }
}

/** Host-side viz-pack-host handler ran for this tile. */
export function noteHostDirect(tileId: string): void {
  applyDrive(tileId, "host-direct");
}

/** Pack unloaded or tile torn down. */
export function clearVizDrive(tileId: string): void {
  const row = tiles.get(tileId);
  if (!row) return;
  row.sandboxWrote = false;
  applyDrive(tileId, "none");
}

export function vizDriveFor(tileId: string): VizDrive {
  return tiles.get(tileId)?.drive ?? "none";
}

/** Tests only. */
export function resetVizDriveState(): void {
  tiles.clear();
  sandboxReady = false;
  const w = window as unknown as { __vizDebug?: VizDebugRoot };
  if (w.__vizDebug) w.__vizDebug.tiles = {};
}
