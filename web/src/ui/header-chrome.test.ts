import { describe, expect, it } from "vitest";
import { setHeaderViewVisible } from "./header-chrome";

describe("setHeaderViewVisible", () => {
  it("hides the header view picker on a wall and shows it for a solo view", () => {
    const box = document.createElement("span");
    box.id = "modeBox";
    const opts = document.createElement("span");
    opts.id = "modeOpts";
    document.body.append(box, opts);

    setHeaderViewVisible(false);
    expect(box.hidden).toBe(true);
    expect(opts.hidden).toBe(true);

    setHeaderViewVisible(true);
    expect(box.hidden).toBe(false);
    expect(opts.hidden).toBe(false);

    box.remove();
    opts.remove();
  });
});
