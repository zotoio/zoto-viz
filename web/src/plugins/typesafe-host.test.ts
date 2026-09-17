import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateMsg } from "../core/types";
import {
  TYPESAFE_FRAME_BUDGET_MS,
  TYPESAFE_HEADROOM_MS,
  TYPESAFE_SETTINGS_KEY,
  TypeSafeHost,
  parseTypeSafeEnable,
  resetTypeSafeSdkFactory,
  setTypeSafeSdkFactory,
  typesafeSenseAllowed,
} from "./typesafe-host";

function minimalState(ts = 1000): StateMsg {
  return {
    type: "state",
    ts,
    iface: "eth0",
    interfaces: ["eth0"],
    network: "192.168.1.0/24",
    local_ip: "192.168.1.2",
    gateway: "192.168.1.1",
    uptime: 60,
    stats: { devices: 1, flows: 0, packets: 0, bytes: 0 },
    devices: [],
    flows: [],
  };
}

describe("typesafe opt-in", () => {
  afterEach(() => {
    localStorage.removeItem(TYPESAFE_SETTINGS_KEY);
    resetTypeSafeSdkFactory();
    vi.restoreAllMocks();
  });

  it("capability off ⇒ zero SDK loads and sense calls", async () => {
    const loader = vi.fn(async () => ({
      sense: vi.fn(async () => ({ answer: { ok: true } })),
    }));
    setTypeSafeSdkFactory(loader);

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: false,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(), { frameMs: 2, headroomMs: 14, dt: 8 });
    expect(loader).not.toHaveBeenCalled();
    expect(host.stats.senseCalls).toBe(0);
    expect(host.pluginStateSlice()).toBeUndefined();
  });

  it("on + no headroom ⇒ no SDK import on continuous tick", async () => {
    const loader = vi.fn(async () => ({
      sense: vi.fn(async () => ({ answer: { ok: true } })),
    }));
    setTypeSafeSdkFactory(loader);

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(), {
      frameMs: 14,
      headroomMs: TYPESAFE_HEADROOM_MS - 1,
      dt: 8,
    });

    expect(loader).not.toHaveBeenCalled();
    expect(host.stats.senseCalls).toBe(0);
    expect(host.stats.skipped).toBe(1);
    const slice = host.pluginStateSlice();
    expect(slice?.typesafe.ok).toBe(false);
    expect(slice?.typesafe.skipped).toBe("no-headroom");
  });

  it("on + over-budget dt ⇒ skip without SDK", async () => {
    const loader = vi.fn(async () => ({
      sense: vi.fn(async () => ({ answer: { ok: true } })),
    }));
    setTypeSafeSdkFactory(loader);

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(), {
      frameMs: 4,
      headroomMs: 12,
      dt: TYPESAFE_FRAME_BUDGET_MS + 1,
    });

    expect(loader).not.toHaveBeenCalled();
    expect(host.pluginStateSlice()?.typesafe.skipped).toBe("over-budget");
  });

  it("freeze one-shot allowed without continuous headroom", async () => {
    const sense = vi.fn(async () => ({ answer: { freeze: true } }));
    setTypeSafeSdkFactory(async () => ({ sense }));

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?sense=1"),
    });

    await host.tick(minimalState(), {
      frameMs: 20,
      headroomMs: 0,
      dt: 50,
    });

    expect(sense).toHaveBeenCalledTimes(1);
    const slice = host.pluginStateSlice();
    expect(slice?.typesafe.mode).toBe("freeze");
    expect(slice?.typesafe.ok).toBe(true);
    expect(slice?.typesafe.answer).toEqual({ freeze: true });
  });

  it("replay serves last freeze shadow without SDK reload", async () => {
    const sense = vi.fn(async () => ({ answer: { n: 1 } }));
    setTypeSafeSdkFactory(async () => ({ sense }));

    const host = new TypeSafeHost();
    host.configure({ packHasCap: true, enable: parseTypeSafeEnable("?sense=1") });
    await host.tick(minimalState(1), { frameMs: 1, headroomMs: 15, dt: 8 });

    host.configure({ packHasCap: true, enable: parseTypeSafeEnable("?sense=replay") });
    await host.tick(minimalState(2), { frameMs: 99, headroomMs: 0, dt: 99 });

    expect(sense).toHaveBeenCalledTimes(1);
    const slice = host.pluginStateSlice();
    expect(slice?.typesafe.mode).toBe("replay");
    expect(slice?.typesafe.answer).toEqual({ n: 1 });
  });

  it("shadow channel shape is plugin_state.typesafe only", async () => {
    setTypeSafeSdkFactory(async () => ({
      sense: async () => ({ answer: { ping: 1 } }),
    }));

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
      contract: { questions: [{ id: "q1", prompt: "ping?" }] },
    });

    await host.tick(minimalState(), { frameMs: 2, headroomMs: 14, dt: 8 });
    const slice = host.pluginStateSlice();
    expect(slice).toEqual({
      typesafe: {
        t: 1000,
        mode: "continuous",
        ok: true,
        answer: { ping: 1 },
        headroomMs: 14,
        frameMs: 2,
        dt: 8,
      },
    });
    expect(Object.keys(slice ?? {})).toEqual(["typesafe"]);
  });

  it("parseTypeSafeEnable covers URL, settings, and sense shapes", () => {
    expect(parseTypeSafeEnable("?typesafe=1", false)).toEqual({
      continuous: true,
      freeze: false,
      replay: false,
    });
    localStorage.setItem(TYPESAFE_SETTINGS_KEY, "1");
    expect(parseTypeSafeEnable("", true)).toEqual({
      continuous: true,
      freeze: false,
      replay: false,
    });
    expect(parseTypeSafeEnable("?sense=1", false)).toEqual({
      continuous: false,
      freeze: true,
      replay: false,
    });
    expect(parseTypeSafeEnable("?sense=replay", false)).toEqual({
      continuous: false,
      freeze: false,
      replay: true,
    });
  });

  it("typesafeSenseAllowed gate documents continuous vs one-shot", () => {
    const good = { frameMs: 4, headroomMs: TYPESAFE_HEADROOM_MS, dt: 10 };
    expect(typesafeSenseAllowed("continuous", good)).toEqual({ ok: true });
    expect(typesafeSenseAllowed("freeze", { frameMs: 99, headroomMs: 0, dt: 99 })).toEqual({ ok: true });
  });
});
