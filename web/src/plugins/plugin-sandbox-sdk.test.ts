import { describe, expect, it } from "vitest";
import type { ZotoVizPluginHost } from "../../../plugins/sdk/plugin-sandbox";

/** Compile-time consumer so plugins/sdk/plugin-sandbox.ts stays referenced on the host branch. */
type _SandboxHost = ZotoVizPluginHost<{ t: number }>;

describe("plugin sandbox SDK types", () => {
  it("exports ZotoVizPluginHost for pack frontends", () => {
    const host: _SandboxHost = {
      onFrame: null,
      onConfig: null,
      writeBuffer: () => {},
      writeUniform: () => {},
    };
    expect(host.onFrame).toBeNull();
  });
});
