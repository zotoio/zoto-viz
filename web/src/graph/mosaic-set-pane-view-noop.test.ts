import { beforeEach, describe, expect, it, vi } from "vitest";
import { Mosaic } from "./mosaic";
import { defaultTree } from "./mosaic-layout";

describe("mosaic setPaneView noop guard", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("returns false when picking the pack view a duplicate slot already shows", () => {
    const assignViews = vi.fn();
    const stub = {
      tree: defaultTree(["plugin:topology", "plugin:topology!1"], "off"),
      tileIds: ["plugin:topology", "plugin:topology!1"],
      assignViews,
      applyPaneTileList(fromId: string, toId: string, next: string[]): boolean {
        if (!this.tree || !toId || fromId === toId) return false;
        if (next.join("\0") === this.tileIds.join("\0")) return false;
        this.assignViews(next);
        return true;
      },
    };
    const setPaneView = Reflect.get(Mosaic.prototype, "setPaneView") as (
      this: typeof stub,
      from: string,
      view: string,
    ) => boolean;
    expect(setPaneView.call(stub, "plugin:topology!1", "plugin:topology")).toBe(false);
    expect(assignViews).not.toHaveBeenCalled();
  });
});
