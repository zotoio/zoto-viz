import { describe, expect, it } from "vitest";
import { NestCamsLive, firstCamera, fixNestAnswerSdp, gridCameras, nestCamCaption, nestEventForPick, nestGridToken, nestIdleNote, nestPickPressed, nestShowEventTiles, nestStillSrc, nestStreamFailover, parseNestLook, sdmSyncKey, streamableCameras, toggleNestPick } from "./nest-cams-live";

describe("nest cams live", () => {
  it("builds a same-origin still URL", () => {
    expect(nestStillSrc("AVPHwNcam", "evt-1")).toBe(
      "/api/sdm/still?device=AVPHwNcam&event=evt-1",
    );
  });

  it("picks a camera by id, then label, then first streamable", () => {
    const rows = [
      { id: "a", label: "Porch", type: "camera", camera: true },
      { id: "b", label: "Kitchen", type: "camera", camera: true },
    ];
    expect(firstCamera(rows, "b")?.label).toBe("Kitchen");
    expect(firstCamera(rows, "Porch")?.id).toBe("a");
    expect(firstCamera(rows, "")?.id).toBe("a");
    expect(firstCamera([], "")).toBeNull();
  });

  it("skips Nest Hub displays unless pick names them", () => {
    const rows = [
      { id: "hub", label: "Kitchen", type: "display", camera: true, webrtc: true },
      { id: "cam", label: "Porch", type: "camera", camera: true, webrtc: true },
    ];
    expect(streamableCameras(rows).map((d) => d.id)).toEqual(["cam"]);
    expect(firstCamera(rows, "")?.id).toBe("cam");
    expect(firstCamera(rows, "Kitchen")?.id).toBe("hub");
  });

  it("fills from streamable cameras when pick is empty, and keeps named picks exact", () => {
    const rows = [
      { id: "hub", label: "Kitchen", type: "display", camera: true, webrtc: true },
      { id: "a", label: "Verandah", room: "Lounge", type: "camera", camera: true },
      { id: "b", label: "Carport", room: "Front", type: "camera", camera: true },
      { id: "c", label: "Backyard", room: "Back", type: "camera", camera: true },
      { id: "d", label: "Lounge", room: "Lounge", type: "camera", camera: true },
      { id: "e", label: "Front", type: "camera", camera: true },
    ];
    expect(gridCameras(rows, "", 4).map((d) => d.label)).toEqual(["Verandah", "Carport", "Backyard", "Lounge"]);
    expect(gridCameras(rows, "Carport,Front", 4).map((d) => d.label)).toEqual(["Carport", "Front"]);
    expect(gridCameras(rows, "", 0).map((d) => d.label)).toEqual(["Verandah", "Carport", "Backyard", "Lounge", "Front"]);
    expect(gridCameras(rows, "", 1).map((d) => d.id)).toEqual(["a"]);
    expect(nestCamCaption(rows[1]!)).toBe("Verandah · Lounge");
    expect(nestCamCaption(rows[1]!, rows)).toBe("Verandah");
    expect(nestCamCaption(rows[4]!, rows)).toBe("Lounge");
    expect(nestCamCaption(rows[2]!, rows)).toBe("Carport");
    expect(nestCamCaption({ id: "c", label: "Backyard", room: "Back", type: "camera", camera: true }, rows)).toBe("Backyard · Back");
  });

  it("ignores poll timestamps when fingerprinting SDM state", () => {
    const look = { live: true, stills: false, pick: "", grid: 4 };
    const a = sdmSyncKey({ linked: true, devices: [], last_list: 1 } as never, look);
    const b = sdmSyncKey({ linked: true, devices: [], last_list: 2 } as never, look);
    expect(a).toBe(b);
  });

  it("fails over when a camera is offline or SDM is busy", () => {
    expect(nestStreamFailover("The camera is not available for streaming.")).toBe(true);
    expect(nestStreamFailover("Internal error encountered.")).toBe(true);
    expect(nestStreamFailover("csrf required")).toBe(false);
  });

  it("keeps only baseline H264 lines for Nest offers", () => {
    const keep = (fmtp: string) => /profile-level-id=42[0e]01f/i.test(fmtp);
    expect(keep("level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f")).toBe(true);
    expect(keep("level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f")).toBe(false);
  });

  it("rewrites Nest sendrecv answers to sendonly", () => {
    const offer = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=recvonly",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=recvonly",
      "",
    ].join("\n");
    const answer = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=sendrecv",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=sendrecv",
      "a=candidate: 1 udp 1 1.1.1.1 9 typ host",
      "",
    ].join("\n");
    const fixed = fixNestAnswerSdp(offer, answer);
    expect(fixed).toContain("a=sendonly");
    expect(fixed).not.toContain("a=sendrecv");
    expect(fixed).toContain("a=candidate:1 1 udp");
  });

  it("defaults live stream on, stills off, and an auto-sized grid", () => {
    expect(parseNestLook(undefined)).toEqual({ live: true, stills: false, pick: "", grid: 0 });
    expect(parseNestLook({ live: "0", pick: "Kitchen", grid: "1" })).toEqual({ live: false, stills: false, pick: "Kitchen", grid: 1 });
    expect(parseNestLook({ grid: "9" }).grid).toBe(6);
    expect(parseNestLook({ grid: "auto" }).grid).toBe(0);
  });

  it("keeps named picks from being padded, and treats empty pick as every streamable camera", () => {
    const rows = [
      { id: "a", label: "Verandah", type: "camera", camera: true },
      { id: "b", label: "Carport", type: "camera", camera: true },
      { id: "c", label: "Front", type: "camera", camera: true },
    ];
    expect(toggleNestPick("", rows[1]!, rows)).toBe("Verandah, Front");
    expect(toggleNestPick("Verandah, Front", rows[1]!, rows)).toBe("");
    expect(nestPickPressed("", rows[0]!)).toBe(true);
    expect(nestPickPressed("Carport", rows[0]!)).toBe(false);
    expect(nestGridToken(0)).toBe("auto");
    expect(nestGridToken(4)).toBe("4");
  });

  it("keeps event stills when live is off, or when stills is on", () => {
    expect(nestShowEventTiles(true, false)).toBe(false);
    expect(nestShowEventTiles(true, true)).toBe(true);
    expect(nestShowEventTiles(false, false)).toBe(true);
    expect(nestIdleNote(true, [])).toBe("");
    expect(nestIdleNote(false, [{ device: "a", event_id: "e1" }])).toBe("");
    expect(nestIdleNote(false, [])).toBe("Live stream off. No recent motion stills.");
  });

  it("filters motion stills to the same camera pick as the wall", () => {
    const rows = [
      { id: "a", label: "Office", type: "camera", camera: true },
      { id: "b", label: "Front", type: "camera", camera: true },
    ];
    expect(nestEventForPick({ device: "a", event_id: "e1" }, rows, "")).toBe(true);
    expect(nestEventForPick({ device: "a", event_id: "e1" }, rows, "Front")).toBe(false);
    expect(nestEventForPick({ device: "b", event_id: "e2" }, rows, "Front")).toBe(true);
    expect(nestEventForPick({ device: "a" }, rows, "")).toBe(false);
  });

  it("reattaches the overlay after mosaic empties the wall", () => {
    const wall = document.createElement("div");
    document.body.append(wall);
    const live = new NestCamsLive(wall);
    expect(wall.querySelector("#nest-cams")).toBe(live.el);
    wall.replaceChildren();
    expect(wall.querySelector("#nest-cams")).toBeNull();
    live.setActive(true);
    expect(wall.querySelector("#nest-cams")).toBe(live.el);
    expect(live.el.hidden).toBe(false);
    expect(live.el.querySelector(".nest-cams-wall")).toBeTruthy();
    wall.remove();
  });
});
