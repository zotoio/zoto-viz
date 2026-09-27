import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateMsg } from "../core/types";
import { resetVizClockInjectors, setVizWallClockInjector } from "../core/viz-clock";
import { VIZ_FRAME_BUDGET_MS } from "../plugins/viz-host";
import {
  TYPESAFE_HEADROOM_MS,
  TYPESAFE_SETTINGS_KEY,
  TypeSafeHost,
  parseTypeSafeEnable,
  resetTypeSafeProxyConfigured,
  resetTypeSafeSdkFactory,
  setTypeSafeProxyConfigured,
  setTypeSafeSdkFactory,
  typesafeSenseAllowed,
} from "./typesafe-host";

const withProxy = () => setTypeSafeProxyConfigured(() => true);

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
    stats: { devices: 1, flows: 0, packets: 0, bytes: 0, pps: 0, bps: 0, online: 1, active_flows: 0 },
    devices: [],
    flows: [],
  };
}

const goodPresent = { presentIntervalMs: 10, headroomMs: VIZ_FRAME_BUDGET_MS - 10 };

describe("typesafe opt-in", () => {
  afterEach(() => {
    localStorage.removeItem(TYPESAFE_SETTINGS_KEY);
    resetTypeSafeSdkFactory();
    resetTypeSafeProxyConfigured();
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

    await host.tick(minimalState(), goodPresent);
    expect(loader).not.toHaveBeenCalled();
    expect(host.stats.senseCalls).toBe(0);
    expect(host.pluginStateSlice()).toBeUndefined();
  });

  it("on + no headroom ⇒ no SDK import on continuous tick", async () => {
    const loader = vi.fn(async () => ({
      sense: vi.fn(async () => ({ answer: { ok: true } })),
    }));
    withProxy();
    setTypeSafeSdkFactory(loader);

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(), {
      presentIntervalMs: 14,
      headroomMs: TYPESAFE_HEADROOM_MS - 1,
    });

    expect(loader).not.toHaveBeenCalled();
    expect(host.stats.senseCalls).toBe(0);
    expect(host.stats.skipped).toBe(1);
    const slice = host.pluginStateSlice();
    expect(slice?.typesafe.ok).toBe(false);
    expect(slice?.typesafe.skipped).toBe("no-headroom");
  });

  it("soft FPS (~29 ms present interval) skips continuous Sense without SDK", async () => {
    const loader = vi.fn(async () => ({
      sense: vi.fn(async () => ({ answer: { ok: true } })),
    }));
    withProxy();
    setTypeSafeSdkFactory(loader);

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(), {
      presentIntervalMs: 29,
      headroomMs: VIZ_FRAME_BUDGET_MS - 29,
    });

    expect(loader).not.toHaveBeenCalled();
    expect(host.stats.senseCalls).toBe(0);
    const skipped = host.pluginStateSlice()?.typesafe.skipped;
    expect(skipped === "over-budget" || skipped === "no-headroom").toBe(true);
  });

  it("freeze one-shot allowed without continuous headroom", async () => {
    const sense = vi.fn(async () => ({ answer: { freeze: true } }));
    withProxy();
    setTypeSafeSdkFactory(async () => ({ sense }));

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?sense=1"),
    });

    await host.tick(minimalState(), {
      presentIntervalMs: 50,
      headroomMs: -33,
    });

    expect(sense).toHaveBeenCalledTimes(1);
    const slice = host.pluginStateSlice();
    expect(slice?.typesafe.mode).toBe("freeze");
    expect(slice?.typesafe.ok).toBe(true);
    expect(slice?.typesafe.answer).toEqual({ freeze: true });
  });

  it("replay serves last freeze shadow without SDK reload", async () => {
    const sense = vi.fn(async () => ({ answer: { n: 1 } }));
    withProxy();
    setTypeSafeSdkFactory(async () => ({ sense }));

    const host = new TypeSafeHost();
    host.configure({ packHasCap: true, enable: parseTypeSafeEnable("?sense=1") });
    await host.tick(minimalState(1), goodPresent);

    host.configure({ packHasCap: true, enable: parseTypeSafeEnable("?sense=replay") });
    await host.tick(minimalState(2), { presentIntervalMs: 99, headroomMs: -82 });

    expect(sense).toHaveBeenCalledTimes(1);
    const slice = host.pluginStateSlice();
    expect(slice?.typesafe.mode).toBe("replay");
    expect(slice?.typesafe.answer).toEqual({ n: 1 });
  });

  it("shadow channel shape is plugin_state.typesafe only", async () => {
    withProxy();
    setTypeSafeSdkFactory(async () => ({
      sense: async () => ({ answer: { ping: 1 } }),
    }));

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
      contract: { questions: [{ id: "q1", prompt: "ping?" }] },
    });

    await host.tick(minimalState(), goodPresent);
    const slice = host.pluginStateSlice();
    expect(slice).toEqual({
      typesafe: {
        t: 1000,
        mode: "continuous",
        ok: true,
        answer: { ping: 1 },
        presentIntervalMs: 10,
        headroomMs: VIZ_FRAME_BUDGET_MS - 10,
      },
    });
    expect(Object.keys(slice ?? {})).toEqual(["typesafe"]);
  });

  it("parseTypeSafeEnable covers URL, localStorage, and sense shapes", () => {
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
    const good = { presentIntervalMs: 10, headroomMs: TYPESAFE_HEADROOM_MS };
    expect(typesafeSenseAllowed("continuous", good)).toEqual({ ok: true });
    expect(typesafeSenseAllowed("freeze", { presentIntervalMs: 99, headroomMs: -82 })).toEqual({ ok: true });
  });

  it("enabled + no monitor proxy ⇒ no-api-key skip and zero SDK load", async () => {
    const loader = vi.fn(async () => ({
      sense: vi.fn(async () => ({ answer: { live: true } })),
    }));
    setTypeSafeSdkFactory(loader);

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(), goodPresent);
    expect(loader).not.toHaveBeenCalled();
    expect(host.stats.senseCalls).toBe(0);
    expect(host.pluginStateSlice()?.typesafe.skipped).toBe("no-api-key");
  });

  it("with proxy + mocked factory ⇒ sense still runs", async () => {
    const sense = vi.fn(async () => ({ answer: { live: true } }));
    withProxy();
    setTypeSafeSdkFactory(async () => ({ sense }));

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(), goodPresent);
    expect(sense).toHaveBeenCalledTimes(1);
    expect(host.pluginStateSlice()?.typesafe.ok).toBe(true);
  });

  it("shadow timestamp uses vizFrameEpochSec (wall clock injector)", async () => {
    resetVizClockInjectors();
    setVizWallClockInjector(() => 4_250);
    withProxy();
    setTypeSafeSdkFactory(async () => ({ sense: vi.fn(async () => ({ answer: { ok: true } })) }));

    const host = new TypeSafeHost();
    host.configure({
      packHasCap: true,
      enable: parseTypeSafeEnable("?typesafe=1"),
    });

    await host.tick(minimalState(0), goodPresent);
    expect(host.pluginStateSlice()?.typesafe.t).toBe(4.25);
    resetVizClockInjectors();
  });
});
