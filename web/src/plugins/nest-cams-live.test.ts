import { describe, expect, it } from "vitest";
import { firstCamera, fixNestAnswerSdp, gridCameras, nestCamCaption, nestStillSrc, nestStreamFailover, parseNestLook, sdmSyncKey, streamableCameras } from "./nest-cams-live";

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

  it("fills a labeled 2×2 from picks then remaining streamable cams", () => {
    const rows = [
      { id: "hub", label: "Kitchen", type: "display", camera: true, webrtc: true },
      { id: "a", label: "Verandah", room: "Lounge", type: "camera", camera: true },
      { id: "b", label: "Carport", room: "Front", type: "camera", camera: true },
      { id: "c", label: "Backyard", room: "Back", type: "camera", camera: true },
      { id: "d", label: "Lounge", room: "Lounge", type: "camera", camera: true },
      { id: "e", label: "Front", type: "camera", camera: true },
    ];
    expect(gridCameras(rows, "", 4).map((d) => d.label)).toEqual(["Verandah", "Carport", "Backyard", "Lounge"]);
    expect(gridCameras(rows, "Carport,Front", 4).map((d) => d.label)).toEqual(["Carport", "Front", "Verandah", "Backyard"]);
    expect(gridCameras(rows, "", 1).map((d) => d.id)).toEqual(["a"]);
    expect(nestCamCaption(rows[1]!)).toBe("Verandah · Lounge");
    expect(nestCamCaption(rows[4]!)).toBe("Lounge");
  });

  it("ignores poll timestamps when fingerprinting SDM state", () => {
    const look = { live: true, pick: "", grid: 4 };
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

  it("defaults live stream on and a 4-pane grid", () => {
    expect(parseNestLook(undefined)).toEqual({ live: true, pick: "", grid: 4 });
    expect(parseNestLook({ live: "0", pick: "Kitchen", grid: "1" })).toEqual({ live: false, pick: "Kitchen", grid: 1 });
    expect(parseNestLook({ grid: "9" }).grid).toBe(4);
  });
});
