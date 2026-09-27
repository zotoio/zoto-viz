import { describe, expect, it } from "vitest";
import { allPhotoSkyKinds, assertPhotoSkyRegistry } from "./photo-sky-registry";

describe("photo sky registry (assets/skies-10)", () => {
  it("every PhotoSkyKind has url, picker entry, and web/public/skies/<id>.jpg", () => {
    assertPhotoSkyRegistry(allPhotoSkyKinds());
  });

  it("revert row: dropping one registration fails registry (see photo-sky-drop-alpine.patch)", () => {
    const kinds = allPhotoSkyKinds().filter((k) => k !== "alpine");
    expect(() => assertPhotoSkyRegistry(kinds)).toThrow(/alpine|registry incomplete/);
  });
});
