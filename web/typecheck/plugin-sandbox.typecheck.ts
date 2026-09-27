import type { ZotoVizPluginHost } from "../../plugins/sdk/plugin-sandbox";

function pluginSandboxSdkTypes(): void {
  const host: ZotoVizPluginHost<{ t: number }> = {
    onFrame: null,
    onConfig: null,
    writeBuffer: () => {},
    writeUniform: () => {},
  };
  void host;
}
void pluginSandboxSdkTypes;
