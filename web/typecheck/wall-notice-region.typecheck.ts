import { postWallNotice } from "../src/core/wall-notice-region";

function typeRows(): void {
  // @ts-expect-error alert keys never auto-clear
  postWallNotice({ key: "install-failed", text: "x", autoClearMs: 5000 });
  // @ts-expect-error action notices never auto-clear
  postWallNotice({ key: "server-restarted", text: "x", action: { label: "Reload", onClick: () => {} }, autoClearMs: 5000 });
}
void typeRows;
