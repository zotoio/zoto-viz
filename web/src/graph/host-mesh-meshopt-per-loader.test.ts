/**
 * Each mosaic pane has its own HostMeshLane and GLTFLoader. The meshopt decoder must be set on
 * every loader, not just the first: memoising the set call left later panes failing with
 * "setMeshoptDecoder must be called before loading compressed files" (no fish, rocks or cars).
 */
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ensureHostMeshoptDecoder } from "./host-mesh-lane";

describe("ensureHostMeshoptDecoder", () => {
  it("sets the decoder on every loader it is given", async () => {
    const a = new GLTFLoader();
    const b = new GLTFLoader();
    await ensureHostMeshoptDecoder(a);
    await ensureHostMeshoptDecoder(b);
    // Revert: the old memoised promise only ever called a.setMeshoptDecoder.
    expect((a as unknown as { meshoptDecoder: unknown }).meshoptDecoder).toBeTruthy();
    expect((b as unknown as { meshoptDecoder: unknown }).meshoptDecoder).toBeTruthy();
  });
});
