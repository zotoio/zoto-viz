/** Shipped packs that still use host-side per-frame UBO drive until they opt into `viz.presentTick`. */
import {
  backroomsSlots,
  parseBackroomsOptions,
  setBackroomsOptions,
} from "../../../plugins/src/backrooms/frontend/director";
import { registerLegacyVizWriteDrive } from "./viz-write-host-drive";

let backroomsOptsJson = "";

registerLegacyVizWriteDrive("backrooms", (ctx) => {
  const drive = backroomsSlots(ctx.skyTime(), new Date(), ctx.aspect());
  ctx.writer.writeBuffer(0, drive.slot0);
  ctx.writer.writeBuffer(1, drive.slot1);
  ctx.syncUbo();
});

/** Sync Backrooms director options from view knobs (host audio bed shares the same module). */
export function syncBackroomsDirectorOptions(opts: Record<string, string>): void {
  const json = JSON.stringify(opts);
  if (json === backroomsOptsJson) return;
  backroomsOptsJson = json;
  setBackroomsOptions(parseBackroomsOptions(opts));
}
