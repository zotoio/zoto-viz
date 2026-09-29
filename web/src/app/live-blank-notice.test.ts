import { describe, expect, it, vi } from "vitest";
import { paintLiveBlankNotice, type LiveBlankNoticeHost } from "./live-blank-notice";
import { paintPackAssetPaneNotice } from "../plugins/pack-asset-pane-notice";

function soloHost(retry = vi.fn()): { host: LiveBlankNoticeHost; el: HTMLElement; retry: typeof retry } {
  const el = document.createElement("div");
  return {
    el,
    retry,
    host: { setPaneNotice: null, paneEl: () => el, soloEl: el, viewName: () => "Koi Pond", retry },
  };
}

describe("live-blank notice", () => {
  it("shows '<View> is running but not showing anything.' with Retry on the notice layer", () => {
    const { host, el, retry } = soloHost();
    paintLiveBlankNotice(host, "plugin:koi-pond", "koi-pond", true);
    const notice = el.querySelector(".mosaic-pane-notice");
    expect(notice?.querySelector(".mosaic-pane-notice-text")?.textContent)
      .toBe("Koi Pond is running but not showing anything.");
    const btn = notice?.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry");
    expect(btn?.textContent).toBe("Retry");
    btn?.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("clears only its own notice", () => {
    const { host, el } = soloHost();
    paintPackAssetPaneNotice(el, "Koi Pond needs review", "default");
    paintLiveBlankNotice(host, "plugin:koi-pond", "koi-pond", false);
    expect(el.querySelector(".mosaic-pane-notice-text")?.textContent).toBe("Koi Pond needs review");
    paintLiveBlankNotice(host, "plugin:koi-pond", "koi-pond", true);
    paintLiveBlankNotice(host, "plugin:koi-pond", "koi-pond", false);
    expect(el.querySelector(".mosaic-pane-notice")).toBeNull();
  });

  it("uses the mosaic pane notice in a mosaic tile", () => {
    const setPaneNotice = vi.fn();
    const el = document.createElement("div");
    paintLiveBlankNotice(
      { setPaneNotice, paneEl: () => el, soloEl: el, viewName: () => "Koi Pond", retry: () => {} },
      "plugin:koi-pond",
      "koi-pond",
      true,
    );
    expect(setPaneNotice).toHaveBeenCalledWith(
      "plugin:koi-pond",
      "Koi Pond is running but not showing anything.",
      "default",
      expect.objectContaining({ showRetry: true }),
    );
  });
});
