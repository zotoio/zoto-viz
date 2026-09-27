import { Window as HappyWindow } from "happy-dom";
import { vi } from "vitest";
import { isHostBootChannel, PLUGIN_SOURCE } from "./sandbox-channel";
import {
  handleSandboxBootChannelMessage,
  resetSandboxFrameRuntimeForTests,
  sandboxFrameRuntimeForTests,
  sandboxZotoApi,
  setSandboxFrameLocationHref,
} from "./sandbox-frame";

let handshakeEnabled = true;
let appendHookInstalled = false;

/** Disable auto frame-ready + boot-channel wiring (e.g. boot timeout tests). */
export function setSandboxTestHandshakeEnabled(on: boolean): void {
  handshakeEnabled = on;
}

export function isSandboxTestHandshakeEnabled(): boolean {
  return handshakeEnabled;
}

/** Wire real MessageChannel boot: iframe listener + synthetic frame-ready from parent. */
export function installSandboxTestHandshake(): void {
  if (appendHookInstalled) return;
  appendHookInstalled = true;
  const appendOrig = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
    const inserted = appendOrig(node);
    if (!handshakeEnabled) return inserted;
    if (node instanceof HTMLIFrameElement && node.hasAttribute("sandbox")) {
      setSandboxFrameLocationHref(node.src);
      let win: Window = node.contentWindow ?? window;
      if (!node.contentWindow || win === window) {
        const frameWin = new HappyWindow({ url: node.src || "about:blank" }) as unknown as Window;
        win = frameWin;
        try {
          Object.defineProperty(node, "contentWindow", { value: frameWin, configurable: true });
        } catch {
          /* keep the HappyWindow reference even if defineProperty fails */
        }
      }
      const frameWin = win;
      (frameWin as unknown as { zoto: typeof sandboxZotoApi }).zoto = sandboxZotoApi;
      const parentWin = window;
      const postMessage = (
        data: unknown,
        _targetOrigin?: string,
        transfer?: Transferable[],
      ) => {
        if (isHostBootChannel(data)) {
          handleSandboxBootChannelMessage(
            {
              data,
              source: parentWin,
              ports: (transfer ?? []) as MessagePort[],
            } as unknown as MessageEvent,
            sandboxFrameRuntimeForTests(),
            sandboxZotoApi,
          );
          return;
        }
        frameWin.dispatchEvent(
          new MessageEvent("message", {
            data,
            source: parentWin,
            ports: (transfer ?? []) as MessagePort[],
          }),
        );
      };
      frameWin.postMessage = postMessage as typeof frameWin.postMessage;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frameWin,
            data: { source: PLUGIN_SOURCE, type: "frame-ready" },
          }),
        );
      });
    }
    return inserted;
  });
}

export function resetSandboxTestHarnessState(): void {
  handshakeEnabled = true;
  resetSandboxFrameRuntimeForTests();
  if (!vi.isMockFunction(document.body.appendChild)) {
    appendHookInstalled = false;
  }
}
