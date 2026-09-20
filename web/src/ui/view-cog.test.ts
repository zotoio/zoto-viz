import { describe, expect, it } from "vitest";
import { makeViewCogButton } from "./view-cog";

describe("makeViewCogButton", () => {
  it("builds a pane settings cog", () => {
    let n = 0;
    const btn = makeViewCogButton({
      className: "mosaic-pane-cog",
      pane: "plugin:memory",
      onClick: () => { n += 1; },
    });
    expect(btn.classList.contains("mosaic-pane-cog")).toBe(true);
    expect(btn.dataset.pane).toBe("plugin:memory");
    expect(btn.getAttribute("aria-label")).toBe("this view settings");
    btn.click();
    expect(n).toBe(1);
  });
});
