/** Test-only boot helper: production-like DOM + mocks, then dynamic import of main.ts */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { StateMsg } from "../../core/types";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

class MockWebSocket {
  static open: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string | URL) {
    MockWebSocket.open.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(): void {}
  close(): void { this.onclose?.(); }
  pushState(msg: StateMsg): void {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
}

function mountIndexDom(): void {
  const raw = readFileSync(path.join(webRoot, "index.html"), "utf8");
  const doc = new DOMParser().parseFromString(raw, "text/html");
  document.head.replaceChildren(...Array.from(doc.head.children).map((n) => n.cloneNode(true)));
  document.body.replaceChildren(...Array.from(doc.body.children).map((n) => n.cloneNode(true)));
}

function stubGl(): void {
  const gl = {
    canvas: { width: 300, height: 150 },
    getExtension: () => null,
    fenceSync: () => ({}),
    getParameter: () => 0,
    viewport: () => {},
    scissor: () => {},
    clearColor: () => {},
    clear: () => {},
    createProgram: () => ({}),
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    attachShader: () => {},
    linkProgram: () => {},
    useProgram: () => {},
    getUniformLocation: () => ({}),
    uniform1f: () => {},
    uniform2f: () => {},
    uniform3f: () => {},
    uniform4f: () => {},
    uniform1i: () => {},
    drawArrays: () => {},
    bindBuffer: () => {},
    bufferData: () => {},
    enable: () => {},
    disable: () => {},
    blendFunc: () => {},
    pixelStorei: () => {},
    deleteProgram: () => {},
    deleteShader: () => {},
    deleteBuffer: () => {},
  };
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
    if (id === "2d") return { setTransform: () => {}, clearRect: () => {}, fillRect: () => {} } as CanvasRenderingContext2D;
    return gl as WebGL2RenderingContext;
  };
}

export function installMainEntryMocks(): void {
  MockWebSocket.open = [];
  const baseFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.includes("style.css")) return Promise.resolve(new Response("", { status: 200 }));
    return baseFetch(input, init);
  }) as typeof fetch);
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("EventSource", class { close() {} });
  vi.stubGlobal("Worker", class {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage(): void { queueMicrotask(() => this.onmessage?.({ data: { type: "ok" } } as MessageEvent)); }
    terminate(): void {}
    addEventListener(type: string, fn: EventListener): void {
      if (type === "message") this.onmessage = fn as (ev: MessageEvent) => void;
    }
    removeEventListener(): void {}
  });
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(performance.now()));
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  stubGl();
}

export type MainEntryHarness = {
  pushState: (msg: StateMsg) => void;
  ws: MockWebSocket;
};

export async function bootMainEntry(): Promise<MainEntryHarness> {
  vi.resetModules();
  installMainEntryMocks();
  mountIndexDom();
  await import("../main.ts");
  const ws = await vi.waitUntil(() => MockWebSocket.open.at(-1), { timeout: 8000 });
  await vi.waitUntil(() => document.getElementById("conn")?.classList.contains("ok"), { timeout: 8000 });
  return {
    ws,
    pushState: (msg) => ws.pushState(msg),
  };
}
