/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as coalesce from "./mosaic-pack-coalesce";
import { Mosaic, mosaicPaneMode } from "./mosaic";

describe("Mosaic syncPackCoalesce", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("syncPackCoalesce calls applyPackCoalesceLayout for duplicate pack tiles", () => {
    const spy = vi.spyOn(coalesce, "applyPackCoalesceLayout");
    const stub = {
      tileIds: ["plugin:star-sines", "plugin:star-sines!1"],
      graphScene: () => ({ setPackCoalesce: () => {} }),
      cfg: { pluginSpecForMode: () => null },
    };
    const sync = Reflect.get(Mosaic.prototype, "syncPackCoalesce") as (this: typeof stub) => void;
    sync.call(stub);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
