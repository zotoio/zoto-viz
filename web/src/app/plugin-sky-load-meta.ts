import type { PluginLook } from "../plugins/plugin";

export type PluginSkyLoadMeta = {
  packId: string;
  packKey: string;
  isShaderPack: boolean;
  look: PluginLook | undefined;
};

let lastSkyLoad: PluginSkyLoadMeta | null = null;

export function recordPluginSkyLoad(meta: PluginSkyLoadMeta): void {
  lastSkyLoad = meta;
}

export function lastPluginSkyLoadForTests(): PluginSkyLoadMeta | null {
  return lastSkyLoad;
}
