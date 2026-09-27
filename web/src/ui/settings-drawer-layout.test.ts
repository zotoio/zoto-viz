import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoStyle = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../style.css"),
  "utf8",
);

const DRAWER_MAX_W = 640;
const DRAWER_VIEW_INSET = 14;
const DRAWER_VIEW_PAD = 28;
const DRAWER_TOP_GAP = 6;

function installStyles(): void {
  const style = document.createElement("style");
  style.textContent = repoStyle;
  document.head.append(style);
}

function drawerWidth(viewW: number): number {
  return Math.min(DRAWER_MAX_W, viewW - DRAWER_VIEW_PAD);
}

function drawerBox(viewW: number, barH = 76): { left: number; right: number; top: number; width: number } {
  const width = drawerWidth(viewW);
  const left = viewW - DRAWER_VIEW_INSET - width;
  return { left, right: left + width, top: barH + DRAWER_TOP_GAP, width };
}

function mountOpenDrawer(viewW: number, viewH: number, barH = 76): {
  pop: HTMLDivElement;
  firstControl: HTMLButtonElement;
} {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: viewW });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: viewH });
  document.documentElement.style.setProperty("--bar-h", `${barH}px`);
  document.body.dataset.chrome = "top";
  document.body.replaceChildren();

  const field = document.createElement("div");
  field.className = "field settings open";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cog";
  btn.setAttribute("aria-label", "settings");

  const pop = document.createElement("div");
  pop.className = "settings-pop drawer";
  pop.setAttribute("role", "dialog");

  const nav = document.createElement("div");
  nav.className = "s-nav";
  const firstControl = document.createElement("button");
  firstControl.type = "button";
  firstControl.className = "s-nav-btn";
  firstControl.textContent = "Graph";
  nav.append(firstControl);

  const body = document.createElement("div");
  body.className = "sbody";
  pop.append(nav, body);
  field.append(btn, pop);
  document.body.append(field);

  return { pop, firstControl };
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete document.body.dataset.chrome;
});

describe("settings drawer layout", () => {
  it("keeps the top-chrome drawer inside the viewport at 1280px wide", () => {
    installStyles();
    const viewW = 1280;
    const viewH = 800;
    const { pop, firstControl } = mountOpenDrawer(viewW, viewH);

    const cs = getComputedStyle(pop);
    expect(cs.position).toBe("fixed");
    expect(cs.right).toBe(`${DRAWER_VIEW_INSET}px`);
    expect(cs.left).toBe("auto");

    const box = drawerBox(viewW);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewW);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeLessThan(viewH);

    firstControl.focus();
    expect(document.activeElement).toBe(firstControl);
  });

  it("keeps the top-chrome drawer inside the viewport at 1024px wide", () => {
    installStyles();
    const viewW = 1024;
    const viewH = 768;
    const { pop, firstControl } = mountOpenDrawer(viewW, viewH);

    const cs = getComputedStyle(pop);
    expect(cs.position).toBe("fixed");
    expect(cs.right).toBe(`${DRAWER_VIEW_INSET}px`);

    const box = drawerBox(viewW);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewW);

    firstControl.focus();
    expect(document.activeElement).toBe(firstControl);
  });
});
