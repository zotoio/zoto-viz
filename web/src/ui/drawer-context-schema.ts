import type { DrawerKey } from "../graph/mosaic-tile-id";

/**
 * Lightweight mirror of `NestCamsDrawerContext` for the tsconfig.test type guard.
 * Keep `devices` in sync with `drawer-context.ts`.
 */
export type Device = {
  id: string;
  label: string;
  room?: string;
  type?: string;
  camera?: boolean;
  webrtc?: boolean;
};

export type NestCamsDrawerContext = {
  key: DrawerKey;
  spec: { id: "nest-cams"; name: string; version: number; engine?: string };
  fields: readonly { key: string; label: string; type: string }[];
  look: Record<string, string | number | boolean | undefined> | null;
  extras: readonly HTMLElement[];
  wallScope: { mosaicOn: boolean; tileModeIds: readonly string[] };
  devices: readonly Device[];
};
