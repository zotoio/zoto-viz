import { describe, expect, it, vi } from "vitest";
import type { PluginView } from "./plugin";
import { renderPackReview } from "./plugin-ui";

const spec: PluginView = {
  id: "pack-a",
  name: "Pack A",
  version: 1,
  has_frontend: true,
  runtime: "typescript",
};

describe("renderPackReview (Needs you → Review, inline, never a modal)", () => {
  it("opens inside the tile notice with Not now focused; Escape is Not now", () => {
    const notice = document.createElement("div");
    document.body.append(notice);
    const onChoice = vi.fn();
    renderPackReview(notice, spec, { onChoice });
    const cancel = notice.querySelector<HTMLButtonElement>(".pack-review-cancel")!;
    expect(document.activeElement).toBe(cancel);
    expect(cancel.textContent).toBe("Not now");
    expect(document.querySelector(".modal.ask")).toBeNull();
    expect(document.querySelector("[aria-modal]")).toBeNull();
    expect(document.body.classList.contains("modal-open")).toBe(false);
    cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onChoice).toHaveBeenCalledWith(null);
    expect(notice.querySelector(".pack-review")).toBeNull();
    notice.remove();
  });

  it("dispose takes the panel down without a choice", () => {
    const notice = document.createElement("div");
    const onChoice = vi.fn();
    const dispose = renderPackReview(notice, spec, { onChoice });
    expect(notice.querySelector(".pack-review")).toBeTruthy();
    dispose();
    expect(notice.querySelector(".pack-review")).toBeNull();
    expect(onChoice).not.toHaveBeenCalled();
  });

  it("changed / stale wording says why the earlier OK does not cover it", () => {
    const notice = document.createElement("div");
    renderPackReview(notice, spec, { state: "changed", onChoice: () => {} });
    expect(notice.textContent).toMatch(/differ from what you approved/);
    const stale = document.createElement("div");
    renderPackReview(stale, spec, { state: "stale", onChoice: () => {} });
    expect(stale.textContent).toMatch(/earlier OK did not cover/);
  });
});
