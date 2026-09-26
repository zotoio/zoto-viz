import type { PluginView } from "./plugin";
import type { VizBufferWriter } from "./viz-host";

export interface LegacyVizWriteContext {
  skyTime: () => number;
  aspect: () => number;
  writer: VizBufferWriter;
  syncUbo: () => void;
}

export type LegacyVizWriteDrive = (ctx: LegacyVizWriteContext) => void;

const LEGACY_DRIVES = new Map<string, LegacyVizWriteDrive>();

export function registerLegacyVizWriteDrive(packId: string, drive: LegacyVizWriteDrive): void {
  LEGACY_DRIVES.set(packId, drive);
}

export function clearLegacyVizWriteDrivesForTests(): void {
  LEGACY_DRIVES.clear();
}

export function legacyVizWriteDrive(spec: PluginView | null | undefined): LegacyVizWriteDrive | null {
  if (!spec?.capabilities?.includes("viz.write")) return null;
  if (spec.viz?.presentTick) return null;
  return LEGACY_DRIVES.get(spec.id) ?? null;
}

export function runLegacyVizWriteDrive(
  spec: PluginView | null | undefined,
  ctx: LegacyVizWriteContext,
): boolean {
  const drive = legacyVizWriteDrive(spec);
  if (!drive) return false;
  drive(ctx);
  return true;
}
