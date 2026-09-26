import { describe, expect, it } from "vitest";
import {
  NIXIE_LOOK_FIELD_BY_KEY,
  NIXIE_LOOK_KEYS,
  type NixieLook,
  type NixieLookKey,
} from "../../../plugins/src/nixie-clock/frontend/tubes";

describe("nixie look option keys", () => {
  it("maps every plugin key to a distinct NixieLook field", () => {
    const m: Record<NixieLookKey, keyof NixieLook> = NIXIE_LOOK_FIELD_BY_KEY;
    expect(m.format).toBe("hour12");
    expect(m.seconds).toBe("seconds");
    expect(m.glow).toBe("glow");
    expect(m.flicker).toBe("flicker");
    expect(new Set(Object.values(m)).size).toBe(4);
    expect(NIXIE_LOOK_KEYS).toEqual(["format", "seconds", "glow", "flicker"]);
  });
});
