import { describe, expect, it } from "vitest";
import { SandboxConfigBatcher } from "./sandbox-config-batcher";

describe("SandboxConfigBatcher", () => {
  it("posts once per frame and skips identical payloads", () => {
    const posts: string[] = [];
    const batcher = new SandboxConfigBatcher(
      (packId, config) => posts.push(`${packId}:${JSON.stringify(config)}`),
      (cb) => { cb(); return 1; },
      () => {},
    );
    batcher.schedule("pack-a", { gain: "3" });
    expect(posts).toEqual(['pack-a:{"gain":"3"}']);
    batcher.schedule("pack-a", { gain: "3" });
    expect(posts).toHaveLength(1);
    for (let i = 0; i < 8; i++) batcher.schedule("pack-a", { gain: "3" });
    expect(posts).toHaveLength(1);
    batcher.schedule("pack-a", { gain: "4" });
    expect(posts).toEqual(['pack-a:{"gain":"3"}', 'pack-a:{"gain":"4"}']);
  });
});
