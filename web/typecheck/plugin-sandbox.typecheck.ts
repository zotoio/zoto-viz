import type { ZotoVizPluginHost } from "../../plugins/sdk/plugin-sandbox";

/** Compile-time proof that pack frontends can import host API types from plugins/sdk. */
export function pluginSandboxHostTypecheck(): void {
  const host: ZotoVizPluginHost<{ t: number }> = {
    onFrame: null,
    onConfig: null,
    writeBuffer: () => {},
    writeUniform: () => {},
  };
  void host;
}
