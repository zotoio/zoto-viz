import {
  formatNixieFallbackLine,
  parseNixieLook,
} from "../../../plugins/src/nixie-clock/frontend/tubes";
import { packetTunnelFallbackText } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import type { ShaderPack } from "../../../plugins/sdk/shader-pack-contract";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";

export type { ShaderPack };

export const SHADER_FALLBACK_TICK_MS = 5000;

const NIXIE_SCRATCH = { h: 0, m: 0, s: 0 };
const NIXIE_CACHE = { key: -1, text: "" };

const HOST_SHADER_PACKS: Record<string, ShaderPack> = {
  "nixie-clock": {
    fallbackText() {
      const now = new Date();
      return formatNixieFallbackLine(
        now,
        parseNixieLook({ format: "24", seconds: "1" }),
        NIXIE_SCRATCH,
        NIXIE_CACHE,
      );
    },
  },
  "packet-tunnel": {
    fallbackText() {
      return packetTunnelFallbackText({ t: 0, packets: [] });
    },
  },
};

/** Host registry entry for a shader pack id (empty object when unknown). */
export function shaderPackForId(packId: string): ShaderPack {
  return HOST_SHADER_PACKS[packId] ?? {};
}

/** Resolve simple-view copy for one pack (hook, generic, or throw/empty). */
export function resolveShaderFallbackLine(pack: ShaderPack | null, packName: string): string {
  if (!pack?.fallbackText) return genericShaderFallbackMessage(packName);
  try {
    const raw = pack.fallbackText();
    if (raw === undefined || raw === "") return genericShaderFallbackMessage(packName);
    const text = String(raw);
    if (text.trim() === "") return genericShaderFallbackMessage(packName);
    return text;
  } catch {
    return genericShaderFallbackMessage(packName);
  }
}
