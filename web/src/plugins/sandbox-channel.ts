/** Host ↔ sandbox messaging after the one-time boot postMessage (MessageChannel port). */

export const HOST_SOURCE = "zoto-viz-host";
export const PLUGIN_SOURCE = "zoto-viz-plugin";

/** Sole window.postMessage from host → frame after frame-ready (transfers a MessagePort). */
export type HostBootChannelMsg = {
  source: typeof HOST_SOURCE;
  type: "boot-channel";
  bootNonce: string;
  parentOrigin: string;
};

export type HostBootPayload = {
  source: typeof HOST_SOURCE;
  type: "boot";
  caps: string[];
  config: Record<string, string>;
  viz?: unknown;
  contractVersion?: number;
  moduleSrc: string;
  bootNonce: string;
  parentOrigin: string;
};

export type HostPortMsg =
  | HostBootPayload
  | { source: typeof HOST_SOURCE; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: typeof HOST_SOURCE; type: "frame"; frame: unknown }
  | { source: typeof HOST_SOURCE; type: "config"; config: Record<string, string> }
  | { source: typeof HOST_SOURCE; type: "present"; tick: { frameMs: number; tileId: string; pluginClock?: number } };

export type PluginPortMsg =
  | { source: typeof PLUGIN_SOURCE; type: "ready"; bootNonce?: string }
  | { source: typeof PLUGIN_SOURCE; type: "setStyle"; payload: Record<string, unknown> }
  | { source: typeof PLUGIN_SOURCE; type: "setNodeColor"; payload: { id: string; hex: number } }
  | { source: typeof PLUGIN_SOURCE; type: "writeBuffer"; payload: { slot: number; data: number[] } }
  | { source: typeof PLUGIN_SOURCE; type: "writeUniform"; payload: { name: string; value: unknown } }
  | { source: typeof PLUGIN_SOURCE; type: "writeParticles"; payload: { data: number[]; stride?: number } }
  | { source: typeof PLUGIN_SOURCE; type: "log"; payload: string };

export function isHostBootChannel(data: unknown): data is HostBootChannelMsg {
  const d = data as HostBootChannelMsg | undefined;
  return !!d && d.source === HOST_SOURCE && d.type === "boot-channel"
    && typeof d.bootNonce === "string" && typeof d.parentOrigin === "string";
}

export function isPluginPortMsg(data: unknown): data is PluginPortMsg {
  const d = data as PluginPortMsg | undefined;
  return !!d && d.source === PLUGIN_SOURCE && typeof d.type === "string";
}
