import { describe, expect, it, vi } from "vitest";
import { attachPluginFrontendAfterConfigReset } from "./plugin-frontend-attach";

describe("attachPluginFrontendAfterConfigReset", () => {
  it("resets the batcher before attach runs", async () => {
    const order: string[] = [];
    const batcher = { reset: () => order.push("reset") };
    await attachPluginFrontendAfterConfigReset(batcher, async () => {
      order.push("attach");
    });
    expect(order).toEqual(["reset", "attach"]);
  });

  it("does not call attach when reset throws", async () => {
    const attach = vi.fn();
    const batcher = { reset: () => { throw new Error("reset failed"); } };
    await expect(attachPluginFrontendAfterConfigReset(batcher, attach)).rejects.toThrow("reset failed");
    expect(attach).not.toHaveBeenCalled();
  });
});
