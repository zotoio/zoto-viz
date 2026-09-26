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

  it("reset clears last payload so identical config posts again after re-attach", () => {
    const posts: string[] = [];
    const batcher = new SandboxConfigBatcher(
      (packId, config) => posts.push(`${packId}:${JSON.stringify(config)}`),
      (cb) => { cb(); return 1; },
      () => {},
    );
    batcher.schedule("pack-a", { gain: "3" });
    batcher.reset();
    batcher.schedule("pack-a", { gain: "3" });
    expect(posts).toEqual(['pack-a:{"gain":"3"}', 'pack-a:{"gain":"3"}']);
  });

  it("posts each distinct pack scheduled in the same frame", () => {
    const posted: { packId: string; config: Record<string, string> }[] = [];
    const batcher = new SandboxConfigBatcher(
      (packId, config) => posted.push({ packId, config }),
      (cb) => { cb(); return 1; },
      () => {},
    );
    batcher.schedule("pack-a", { gain: "0" });
    batcher.schedule("pack-b", { gain: "0" });
    expect(posted).toHaveLength(2);
    expect(posted.map((p) => p.packId).sort()).toEqual(["pack-a", "pack-b"]);
  });

  it("posts when schedule is called with an empty config object", () => {
    const posts: string[] = [];
    const batcher = new SandboxConfigBatcher(
      (packId, config) => posts.push(`${packId}:${JSON.stringify(config)}`),
      (cb) => { cb(); return 1; },
      () => {},
    );
    batcher.schedule("pack-a", {});
    expect(posts).toEqual(["pack-a:{}"]);
  });
});
