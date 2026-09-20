import { afterEach, describe, expect, it, vi } from "vitest";
import { DEBUG_STORE, DebugLog, cursorStatsPath, formatCursorStats, formatLogTime, logsPath, readDebugOn, writeDebugOn } from "./debug-log";
import { FLOAT_STORE } from "./float-drag";

afterEach(() => {
  localStorage.removeItem(DEBUG_STORE);
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(FLOAT_STORE)) localStorage.removeItem(key);
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("debug log helpers", () => {
  it("stores the header toggle and builds an after query", () => {
    expect(readDebugOn()).toBe(false);
    writeDebugOn(true);
    expect(readDebugOn()).toBe(true);
    expect(logsPath(12.8)).toBe("/api/logs?after=12");
    expect(logsPath(-1)).toBe("/api/logs?after=0");
    expect(cursorStatsPath()).toBe("/api/ai/cursor-stats?tail=40");
    expect(formatCursorStats({
      op: "chat",
      model: "grok-4.6",
      status: "finished",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      cost: { chargedCents: 1.2, rawCostCents: 1.5 },
      account: { apiKeyName: "titan" },
    })).toBe("cursor stats chat grok-4.6 finished in=12 out=4 total=16 charged=1.2¢ raw=1.5¢ key=titan");
  });

  it("formats a unix timestamp as 24h clock", () => {
    expect(formatLogTime(0)).toBe("--:--:--");
    const s = formatLogTime(1_700_000_000);
    expect(s).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("DebugLog", () => {
  it("polls /api/logs and appends lines while on", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (String(url).includes("cursor-stats")) {
          return {
            lines: [{
              id: "s1",
              t: 1_700_000_010,
              op: "chat",
              model: "grok-4.6",
              usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
            }],
          };
        }
        return { seq: 2, lines: [{ seq: 2, t: 1_700_000_000, text: "wifi scan: 3 access points" }] };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const log = new DebugLog(host);
    log.setOn(true);
    await vi.waitFor(() => {
      expect(host.hidden).toBe(false);
      expect(host.textContent).toContain("wifi scan: 3 access points");
      expect(host.textContent).toContain("cursor stats chat grok-4.6");
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/logs?after=0");
    expect(document.body.classList.contains("debug-open")).toBe(true);
    expect(host.querySelector("h2")?.textContent).toBe("debug");
    log.setOn(false);
    expect(host.hidden).toBe(true);
    expect(document.body.classList.contains("debug-open")).toBe(false);
    log.dispose();
  });

  it("close button calls onClose", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const log = new DebugLog(host);
    const closed: boolean[] = [];
    log.onClose = () => closed.push(true);
    log.setOn(true);
    host.querySelector<HTMLElement>(".close")?.click();
    expect(closed).toEqual([true]);
    log.dispose();
  });
});
