import { postWallNotice } from "../src/core/wall-notice-region";

function typeRows(): void {
  postWallNotice({ key: "server-restarted", text: "x", autoClearMs: 5000 });
  postWallNotice({ key: "install-failed", text: "x", action: { label: "Retry", onClick: () => {} } });
  // @ts-expect-error alert keys never auto-clear
  postWallNotice({ key: "install-failed", text: "x", autoClearMs: 5000 });
  // @ts-expect-error action notices never auto-clear
  postWallNotice({ key: "server-restarted", text: "x", action: { label: "Reload", onClick: () => {} }, autoClearMs: 5000 });
}
void typeRows;
