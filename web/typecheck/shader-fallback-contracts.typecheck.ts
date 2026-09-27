import type { ShaderPack } from "../../plugins/sdk/shader-pack-contract";
import type { VizZotoPluginHooks } from "../../plugins/sdk/viz-contract";

function useShaderPack(pack: ShaderPack): void {
  void pack.fallbackText?.();
}

function useZotoHooks(hooks: VizZotoPluginHooks): void {
  void hooks;
}

const pack: ShaderPack = { fallbackText: () => "ok" };
useShaderPack(pack);
useZotoHooks({});
