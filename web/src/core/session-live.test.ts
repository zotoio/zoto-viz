import { afterEach, describe, expect, it } from "vitest";
import { shippedSettings } from "./profiles";
import { readSessionLive, SESSION_LIVE_KEY, writeSessionLive } from "./session-live";

describe("session live snapshot", () => {
  afterEach(() => {
    sessionStorage.removeItem(SESSION_LIVE_KEY);
  });

  it("round-trips settings and restores defaults for junk fields", () => {
    const settings = { ...shippedSettings(), theme: "ember", dream: true, mode: "plugin:talkers", camera: "off" as const };
    writeSessionLive({ profileId: "user", dirty: true, settings, selected: "192.168.86.4", aiCycle: true });
    const live = readSessionLive();
    expect(live?.profileId).toBe("user");
    expect(live?.dirty).toBe(true);
    expect(live?.settings.theme).toBe("ember");
    expect(live?.settings.dream).toBe(true);
    expect(live?.settings.camera).toBe("off");
    expect(live?.selected).toBe("192.168.86.4");
    expect(live?.aiCycle).toBe(true);
    expect(live?.settings.show.lan).toBe(true);
  });

  it("returns null for missing or invalid blobs", () => {
    expect(readSessionLive()).toBeNull();
    sessionStorage.setItem(SESSION_LIVE_KEY, "{");
    expect(readSessionLive()).toBeNull();
    sessionStorage.setItem(SESSION_LIVE_KEY, JSON.stringify({ v: 2, settings: {} }));
    expect(readSessionLive()).toBeNull();
  });
});
