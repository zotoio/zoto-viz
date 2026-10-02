/** #254: refusal kinds are recognised by reason code, even when the copy lacks the old words. */
import { describe, expect, it } from "vitest";
import { catalogErrorLooksBlocked, isPackInstallBlockedPayload, PACK_CHECK_FAILED } from "./pack-install-surface";

describe("#254 pack refusal reason codes", () => {
  it("a check failure without the old words is still that refusal", () => {
    const row = {
      error: "pack_note",
      reasonCode: PACK_CHECK_FAILED,
      message: "Star Sines needs another look before it can be installed.",
    };
    expect(row.message).not.toContain("Couldn't safety-check");
    expect(row.message).not.toContain("blocked");
    expect(isPackInstallBlockedPayload(row)).toBe(true);
    expect(catalogErrorLooksBlocked(row.message, row.reasonCode)).toBe(true);
    expect(isPackInstallBlockedPayload({ ...row, reasonCode: "" })).toBe(false);
    expect(catalogErrorLooksBlocked(row.message)).toBe(false);
  });
});
