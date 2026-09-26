import { afterEach, describe, expect, it } from "vitest";
import { SERVER_RESTART_NOTICE } from "./http";
import { bindServerRestartNoticeToHint } from "./http-notice";

describe("server restart notice", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows notice in #hint once", () => {
    expect.hasAssertions();
    document.body.innerHTML = "<div id=\"hint\"></div>";
    const hint = document.getElementById("hint")!;
    const off = bindServerRestartNoticeToHint();
    try {
      window.dispatchEvent(
        new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
      );
      expect(hint.textContent).toBe(SERVER_RESTART_NOTICE);
    } finally {
      off();
    }
  });
});
