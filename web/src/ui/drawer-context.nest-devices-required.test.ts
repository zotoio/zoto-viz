import type { DrawerKey } from "../graph/mosaic-tile-id";
import type { NestCamsDrawerContext } from "./drawer-context-schema";

const wallScope = { mosaicOn: false, tileModeIds: [] as string[] };
const key = "plugin:nest-cams" as DrawerKey;

// @ts-expect-error nest cams drawer context requires devices
export const nestCamsContextMissingDevices: NestCamsDrawerContext = {
  key,
  spec: { id: "nest-cams", name: "Nest cams", version: 1, engine: "graph" },
  fields: [],
  look: null,
  extras: [],
  wallScope,
};
