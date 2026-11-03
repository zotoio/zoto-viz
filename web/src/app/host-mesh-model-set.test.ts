import { describe, expect, it } from "vitest";
import { hostMeshDeclsForSet, hostMeshModelSet } from "./host-mesh-bridge";

type Decl = { id: string; path: string };

describe("host mesh model set", () => {
  const decls: Decl[] = [
    { id: "koi-a", path: "assets/koi-a.glb" },
    { id: "rocks", path: "assets/rocks.glb" },
    { id: "koi-a-hd", path: "assets/koi-a-hd.glb" },
  ];

  it("defaults to standard and only takes hd when asked", () => {
    expect(hostMeshModelSet(undefined)).toBe("standard");
    expect(hostMeshModelSet({ modelSet: "nope" })).toBe("standard");
    expect(hostMeshModelSet({ modelSet: "hd" })).toBe("hd");
  });

  it("standard drops the hd entries and keeps the slot order", () => {
    expect(hostMeshDeclsForSet(decls, "standard").map((d) => [d.id, d.path])).toEqual([
      ["koi-a", "assets/koi-a.glb"],
      ["rocks", "assets/rocks.glb"],
    ]);
  });

  it("hd loads the hd file under the standard id, and keeps assets without one", () => {
    expect(hostMeshDeclsForSet(decls, "hd").map((d) => [d.id, d.path])).toEqual([
      ["koi-a", "assets/koi-a-hd.glb"],
      ["rocks", "assets/rocks.glb"],
    ]);
  });
});
