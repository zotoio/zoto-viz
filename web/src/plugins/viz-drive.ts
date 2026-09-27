/** Which path applies viz pack writes for a tile (QE / visible runs). */
export type VizDrive = "sandbox" | "host-direct" | "none";

type TileRow = {
  el: HTMLElement | null;
  drive: VizDrive;
};

const tiles = new Map<string, TileRow>();

function applyDrive(tileId: string, next: VizDrive): void {
  const row = tiles.get(tileId);
  if (!row || row.drive === next) return;
  row.drive = next;
  if (row.el) row.el.dataset.vizDrive = next;
}

/** Attach or refresh the DOM node for a tile id (`main` or mosaic mode id). */
export function bindVizDriveElement(tileId: string, el: HTMLElement | null): void {
  let row = tiles.get(tileId);
  if (!row) {
    row = { el: null, drive: "none" };
    tiles.set(tileId, row);
  }
  row.el = el;
  if (el) el.dataset.vizDrive = row.drive;
  else if (row.drive !== "none") applyDrive(tileId, "none");
}

/** Host-side viz-pack-host handler ran for this tile. */
export function noteHostDirect(tileId: string): void {
  applyDrive(tileId, "host-direct");
}

/** Pack unloaded or tile torn down. */
export function clearVizDrive(tileId: string): void {
  const row = tiles.get(tileId);
  if (!row) return;
  applyDrive(tileId, "none");
}
