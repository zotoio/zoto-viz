import { describe, expect, it, vi } from "vitest";
import { visiblePoll } from "./visible-poll";

describe("visiblePoll", () => {
  it("skips while hidden and catches up once on return", () => {
    const l = new Set<() => void>();
    const doc: { visibilityState: DocumentVisibilityState; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void } = {
      visibilityState: "visible",
      addEventListener: (_: string, f: () => void) => { l.add(f); }, removeEventListener: (_: string, f: () => void) => { l.delete(f); } };
    const fn = vi.fn();
    const p = visiblePoll(fn, doc);
    p(); expect(fn).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden"; p(); p(); p();
    expect(fn).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible"; for (const f of l) f();
    expect(fn).toHaveBeenCalledTimes(2);
    for (const f of l) f();
    expect(fn).toHaveBeenCalledTimes(2);
    p.dispose(); expect(l.size).toBe(0);
  });
});
