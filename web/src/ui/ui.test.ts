import { describe, expect, it } from "vitest";
import { ColorField, group, pinFlyout, Select, Slider, TextField, Toggle, unpinFlyout } from "./ui";

describe("Select", () => {
  it("creates a labelled control and opens", () => {
    const s = new Select({ caption: "view", options: [{ value: "a", label: "A" }, { value: "b", label: "B", hint: "h", swatch: "#abc" }] });
    expect(s.el.querySelector(".cap")?.textContent).toBe("view");
    s.value = "b";
    expect(s.value).toBe("b");
    s.open();
    expect(s.isOpen).toBe(true);
    s.close();
    expect(s.isOpen).toBe(false);
  });
});

describe("controls", () => {
  it("wires text, slider, colour, toggle, and group", () => {
    const tf = new TextField({ caption: "name", value: "x" });
    tf.value = "y";
    expect(tf.value).toBe("y");
    tf.hidden = true;
    expect(tf.hidden).toBe(true);

    const sl = new Slider({ label: "gain", min: 0, max: 10, step: 1, value: 3 });
    sl.value = 5;
    expect(sl.value).toBe(5);

    const cf = new ColorField({ label: "sky", value: "", themeHex: "#112233" });
    expect(cf.value).toBe("");
    cf.value = "#ff0000";
    expect(cf.value).toBe("#ff0000");
    cf.setThemeHex("#000000");

    const t = new Toggle({ label: "on", checked: false });
    t.checked = true;
    expect(t.checked).toBe(true);
    t.disabled = true;
    expect(t.disabled).toBe(true);

    const g = group("row", t, sl);
    expect(g.querySelector(".cap")?.textContent).toBe("row");

    const fly = document.createElement("div");
    const home = document.createElement("div");
    const trigger = document.createElement("button");
    document.body.append(home, trigger);
    home.append(fly);
    pinFlyout(fly, trigger, "left");
    expect(fly.classList.contains("flyout")).toBe(true);
    unpinFlyout(fly, home);
    expect(fly.classList.contains("flyout")).toBe(false);
  });
});
