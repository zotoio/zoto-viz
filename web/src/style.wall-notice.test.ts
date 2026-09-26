import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const stylePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "style.css");

describe("mosaic wall notice layout", () => {
  beforeEach(() => {
    expect.hasAssertions();
    document.documentElement.style.setProperty("--bar-h", "44px");
    document.body.innerHTML = "<div id=\"wall\"><div class=\"mosaic-wall-notice\">notice</div></div>";
    const style = document.createElement("style");
    style.textContent = readFileSync(stylePath, "utf8");
    document.head.appendChild(style);
  });

  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("pins the restart strip above the wall with shared single and mosaic placement", () => {
    const el = document.querySelector("#wall .mosaic-wall-notice") as HTMLElement;
    const cs = getComputedStyle(el);
    expect(cs.position).toBe("fixed");
    expect(cs.top).toBe("calc(44px + 8px)");
    expect(cs.left).toBe("50%");
    expect(cs.transform).toBe("translateX(-50%)");
    expect(cs.zIndex).toBe("30");
    expect(cs.maxWidth).toBe("min(921.6px, 720px)");
    expect(cs.flex).toBe("0 0 auto");
    expect(cs.margin).toBe("0px");
    expect(cs.pointerEvents).toBe("auto");
  });
});
