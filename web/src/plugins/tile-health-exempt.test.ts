import { describe, expect, it } from "vitest";
import {
  TILE_EMPTY_STREAK,
  TILE_LOAD_GRACE_MS,
  freshTileHealthState,
  stepTileHealth,
} from "./tile-health";
import { applyTileExemptReset, graceUntilFrom, tileHealthExempt } from "./tile-health-exempt";

function rgbaFill(r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("tileHealthExempt", () => {
  it("covers tab hidden, off-screen, approval, and grace", () => {
    const base = { onScreen: true, awaitingApproval: false, graceUntil: 0, now: 10_000 };
    expect(tileHealthExempt({ ...base, tabVisible: false })).toBe(true);
    expect(tileHealthExempt({ ...base, tabVisible: true, onScreen: false })).toBe(true);
    expect(tileHealthExempt({ ...base, tabVisible: true, awaitingApproval: true })).toBe(true);
    expect(tileHealthExempt({ ...base, tabVisible: true, graceUntil: graceUntilFrom(0), now: 1000 })).toBe(true);
    expect(tileHealthExempt({ ...base, tabVisible: true, now: TILE_LOAD_GRACE_MS + 1 })).toBe(false);
  });

  it("resets streak and backoff when exempt", () => {
    const state = {
      ...freshTileHealthState(),
      emptyStreak: 2,
      backoffUntil: 99_999,
      lastMessage: "pending",
    };
    const next = applyTileExemptReset(state, {
      tabVisible: true,
      onScreen: true,
      awaitingApproval: true,
      graceUntil: 0,
      now: 0,
    });
    expect(next.emptyStreak).toBe(0);
    expect(next.backoffUntil).toBe(0);
    expect(next.lastMessage).toBe("");
  });
});

describe("grace + flat checks", () => {
  const patch = rgbaFill(0, 0, 0);
  const signals = {
    mayBeStatic: false,
    contextLost: false,
    pictureSerial: 0,
    dataFramesArriving: true,
    drawingNothing: false,
  };

  it("does not heal during grace then needs three checks after", () => {
    let state = freshTileHealthState();
    const heals: string[] = [];
    const graceStart = 0;
    for (let i = 0; i < TILE_EMPTY_STREAK; i++) {
      const now = 1000 + i * 500;
      if (now < graceStart + TILE_LOAD_GRACE_MS) {
        state = applyTileExemptReset(state, {
          tabVisible: true,
          onScreen: true,
          awaitingApproval: false,
          graceUntil: graceUntilFrom(graceStart),
          now,
        });
        continue;
      }
      const out = stepTileHealth(state, now, {
        patch,
        lastCheckPictureSerial: state.lastCheckPictureSerial,
        signals,
      }, "t", "p");
      state = out.state;
      if (out.heal) heals.push(out.heal);
    }
    expect(heals).toHaveLength(0);
    expect(state.emptyStreak).toBe(0);

    const after = stepTileHealth(state, graceStart + TILE_LOAD_GRACE_MS + 100, {
      patch,
      lastCheckPictureSerial: state.lastCheckPictureSerial,
      signals,
    }, "t", "p");
    expect(after.heal).toBeNull();
    expect(after.state.emptyStreak).toBe(1);
  });
});
