import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  PACK_RETRY_BUTTON_BUSY,
  PACK_RETRY_BUTTON_IDLE,
  packRetryStartFailedMessage,
  packRetrySuccessHistoryMessage,
  packRetryZipChangedMessage,
} from "./pack-install-retry-copy";
import {
  applyPackInstallRetryResponse,
  blockedRecordDisplayMessage,
  isPackRetryInFlight,
  packInstallHistory,
  packRetryButtonState,
  resetPackInstallRetryForTests,
  submitPackInstallRetry,
} from "./pack-install-retry";
import {
  resetPackInstallSurfaceForTests,
  syncBlockedCatalogFromErrors,
  blockedCatalogEntries,
} from "./pack-install-surface";

const SHA = "a".repeat(64);

function seedCouldntStartRecord(): void {
  syncBlockedCatalogFromErrors([{
    error: "pack_install_start_failed",
    blockReason: "couldnt_start",
    message: "Upgrade probe v2 couldn't start, so v1 was restored",
    name: "Upgrade probe",
    id: "upgrade-probe",
    zip: "/tmp/upgrade-probe.zip",
    sha256: SHA,
    zipSha256: SHA,
    retryable: "true",
  }]);
}

describe("pack install retry UX", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });
  beforeEach(() => {
    resetPackInstallSurfaceForTests();
    resetPackInstallRetryForTests();
    vi.restoreAllMocks();
  });

  it("in flight: disables button and shows Retrying…; second submit is a no-op", async () => {
    seedCouldntStartRecord();
    let resolveFetch!: (v: Response) => void;
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => fetchPromise as Promise<Response>);

    const first = submitPackInstallRetry(SHA);
    expect(isPackRetryInFlight(SHA)).toBe(true);
    expect(packRetryButtonState(SHA)).toEqual({ disabled: true, label: PACK_RETRY_BUTTON_BUSY });

    await expect(submitPackInstallRetry(SHA)).resolves.toBe("in_progress");

    resolveFetch(new Response(JSON.stringify({ retryResult: "start_failed", name: "Upgrade probe", version: 2 }), { status: 400 }));
    await first;
    expect(packRetryButtonState(SHA)).toEqual({ disabled: false, label: PACK_RETRY_BUTTON_IDLE });
  });

  it("start_failed: updates blocked record in place with still-couldn't-start copy", () => {
    seedCouldntStartRecord();
    const body = {
      retryResult: "start_failed",
      name: "Upgrade probe",
      version: 2,
      message: packRetryStartFailedMessage("Upgrade probe", 2),
    };
    applyPackInstallRetryResponse(SHA, 400, body);
    const entry = blockedCatalogEntries()[0]!;
    expect(blockedRecordDisplayMessage(entry)).toBe(
      "Upgrade probe v2 still couldn't start, so v1 is still active",
    );
    expect(packInstallHistory()).toEqual([]);
    expect(packRetryButtonState(SHA).label).toBe(PACK_RETRY_BUTTON_IDLE);
  });

  it("zip_changed: keeps blocked row with zip-changed copy", () => {
    seedCouldntStartRecord();
    applyPackInstallRetryResponse(SHA, 409, {
      retryResult: "zip_changed",
      name: "Upgrade probe",
      message: packRetryZipChangedMessage("Upgrade probe"),
    });
    expect(blockedCatalogEntries()).toHaveLength(1);
    expect(blockedRecordDisplayMessage(blockedCatalogEntries()[0]!)).toBe(
      "Upgrade probe has changed since it was blocked. It'll be checked again on the next scan.",
    );
  });

  it("success: removes blocked row and appends history line", () => {
    seedCouldntStartRecord();
    applyPackInstallRetryResponse(SHA, 200, {
      ok: true,
      retryResult: "success",
      name: "Upgrade probe",
      version: 2,
    });
    expect(blockedCatalogEntries()).toHaveLength(0);
    expect(packInstallHistory()).toEqual([packRetrySuccessHistoryMessage("Upgrade probe", 2)]);
  });
});
