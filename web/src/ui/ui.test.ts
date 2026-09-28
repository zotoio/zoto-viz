import { describe, expect, it } from "vitest";
import { ColorField, GroupedChips, group, makePaneDiceButton, morphCopy, mountDiceSplit, pinFlyout, Select, Slider, TextField, Toggle, unpinFlyout } from "./ui";

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

  it("groups options and filters by label", () => {
    const s = new Select({
      caption: "view",
      filterable: true,
      options: [
        { value: "topo", label: "Topology", group: "graph" },
        { value: "kefrens", label: "Kefrens Bars", group: "demo" },
        { value: "pong", label: "Pong", group: "arcade" },
      ],
    });
    s.open();
    expect(s.el.querySelector(".menu-group")?.textContent).toBe("graph");
    expect([...s.el.querySelectorAll(".menu-group")].map((el) => el.textContent)).toEqual(["graph", "demo", "arcade"]);
    const input = s.el.querySelector<HTMLInputElement>(".menu-filter-input");
    expect(input).toBeTruthy();
    input!.value = "kef";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    const opts = [...s.el.querySelectorAll("li[role='option']")].map((el) => el.textContent);
    expect(opts.some((t) => t?.includes("Kefrens"))).toBe(true);
    expect(opts.some((t) => t?.includes("Topology"))).toBe(false);
    s.close();
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
    const chips = new GroupedChips({
      label: "sky",
      groups: [{ id: "all", label: "all" }, { id: "nature", label: "nature" }],
      value: "aurora",
      options: [
        { value: "aurora", label: "aurora", hint: "polar", group: "nature" },
        { value: "matrix", label: "matrix", hint: "code", group: "digital" },
      ],
    });
    expect(chips.value).toBe("aurora");
    chips.set("matrix");
    expect(chips.value).toBe("matrix");
    expect(chips.el.querySelector(".chip-search")).toBeTruthy();

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

  it("puts a roll icon on the right that does not flip the dice switch", () => {
    let toggles = 0;
    let rolls = 0;
    const t = new Toggle({ label: "dice", checked: false, onChange: () => { toggles += 1; } });
    const box = document.createElement("span");
    box.id = "diceBox";
    document.body.append(box);
    const btn = mountDiceSplit(box, t, () => { rolls += 1; });
    expect(box.classList.contains("dice-split")).toBe(true);
    expect(btn.getAttribute("aria-label")).toBe("roll now");
    expect(btn.querySelector("svg")).toBeTruthy();
    expect(box.lastElementChild).toBe(btn);
    btn.click();
    expect(rolls).toBe(1);
    expect(toggles).toBe(0);
    expect(t.checked).toBe(false);
    t.el.click();
    expect(rolls).toBe(1);
    expect(toggles).toBe(1);
    expect(t.checked).toBe(true);
    box.remove();
  });

  it("builds a pane dice that rolls without toggling anything else", () => {
    let rolls = 0;
    const btn = makePaneDiceButton({ pane: "plugin:cpu", onClick: () => { rolls += 1; } });
    expect(btn.classList.contains("mosaic-pane-dice")).toBe(true);
    expect(btn.dataset.pane).toBe("plugin:cpu");
    expect(btn.getAttribute("aria-label")).toBe("roll this pane");
    expect(btn.querySelector("svg")).toBeTruthy();
    btn.click();
    expect(rolls).toBe(1);
    expect(btn.classList.contains("rolling")).toBe(true);
  });

  it("morphs copy instead of snapping the text", async () => {
    const el = document.createElement("div");
    el.textContent = "a";
    morphCopy(el, "b", 40);
    expect(el.classList.contains("morphing")).toBe(true);
    expect(el.textContent).toBe("a");
    await new Promise((r) => setTimeout(r, 50));
    expect(el.textContent).toBe("b");
    expect(el.classList.contains("morphing")).toBe(false);
  });
});
