import { describe, expect, it } from "vitest";
import {
  TERM_COLS, TERM_ROWS, packScreen, preferHnStories, scriptFromStories, visibleScreen, wrapLines,
} from "../../../plugins/src/hn-term/frontend/teletype";

describe("hn-term teletype", () => {
  it("prefers Hacker News rows and keeps the blurb", () => {
    const stories = preferHnStories([
      { id: "nasa:0", label: "NASA", text: "Photo", summary: "Mars" },
      { id: "hn:0", label: "Hacker News", text: "Jemalloc", summary: "A new allocator." },
    ]);
    expect(stories).toEqual([{ title: "Jemalloc", body: "A new allocator." }]);
    expect(scriptFromStories(stories)).toContain("$ Jemalloc");
    expect(scriptFromStories(stories)).toContain("A new allocator.");
  });

  it("wraps and scrolls so the cursor sits on the last typed line", () => {
    const lines = wrapLines("hello world from the terminal", 8);
    expect(lines[0]).toBe("hello");
    const screen = visibleScreen("$ ab\ncd", 8, 8, 3);
    expect(screen.cells.length).toBe(24);
    expect(screen.cursorRow).toBe(2);
    expect(screen.cells.trim().endsWith("cd") || screen.cells.includes("cd")).toBe(true);
  });

  it("packs a UBO-sized screen", () => {
    const screen = visibleScreen("$ hn\nhello", 11, TERM_COLS, TERM_ROWS);
    const buf = packScreen(screen, 0.4, 1);
    expect(buf.length).toBe(8 + TERM_COLS * TERM_ROWS);
    expect(buf.length).toBeLessThanOrEqual(64);
    expect(buf[0]).toBe(TERM_COLS);
    expect(buf[1]).toBe(TERM_ROWS);
    expect(buf[5]).toBeCloseTo(0.4);
    const letters = buf.slice(8).map((v) => String.fromCharCode(Math.round(v * 95) + 32)).join("");
    expect(letters).toContain("HN");
    expect(letters).toContain("HELLO");
    expect(letters).not.toMatch(/[a-z]/);
  });
});
