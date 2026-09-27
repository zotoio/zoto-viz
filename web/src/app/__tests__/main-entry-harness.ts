/** Test-only boot helper: production-like DOM + mocks, then dynamic import of main.ts */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";
import type { StateMsg } from "../../core/types";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Plugin row returned from /api/plugins — async boot must call installPlugins before this mode exists. */
export const HARNESS_PLUGIN_MODE = "plugin:harness-entry";
export const HARNESS_PLUGIN_ALT = "plugin:harness-alt";

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
  for (const el of doc.querySelectorAll("script")) el.remove();
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

const PROFILE_LIST = {
  default: "user",
  fresh: false,
  file: "/tmp/profiles.yml",
  profiles: [
    { id: "zoto-viz", label: "zoto viz", shipped: true },
    { id: "user", label: "user", shipped: false },
  ],
};

function apiPath(input: RequestInfo | URL): string {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0]!;
  }
}

function harnessFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const pathOnly = apiPath(input);
  const method = (init?.method || "GET").toUpperCase();
  if (pathOnly.includes("style.css")) {
    return Promise.resolve(new Response("", { status: 200, headers: { "Content-Type": "text/css" } }));
  }
  if (pathOnly === "/api/session") {
    const body = JSON.stringify({
      csrf: "harness-csrf",
      aiControl: false,
      pluginService: true,
      typesafeConfigured: false,
    });
    return Promise.resolve(new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Zoto-Viz-Csrf": "harness-csrf" },
    }));
  }
  if (pathOnly === "/api/profiles/shipped" && method === "POST") {
    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  if (pathOnly === "/api/profiles" && (method === "GET" || method === "POST")) {
    return Promise.resolve(new Response(JSON.stringify(PROFILE_LIST), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }
  if (pathOnly.startsWith("/api/profiles/") && method === "GET") {
    return Promise.resolve(new Response(JSON.stringify({ settings: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }
  if (pathOnly === "/api/plugins") {
    const body = JSON.stringify({
      dir: "",
      schema: "",
      plugins: [
        {
          id: "harness-entry",
          name: "Harness entry",
          version: 1,
          engine: "graph",
          base: "topology",
          look: { backdrop: "space" },
          has_frontend: false,
          frontend: { entry: "frontend/index.ts" },
          capabilities: [],
          has_sky: false,
          has_sky_shader: false,
          has_backend: false,
          has_datasource: false,
        },
        {
          id: "harness-alt",
          name: "Harness alt",
          version: 1,
          engine: "graph",
          base: "topology",
          look: { backdrop: "matrix" },
          has_frontend: false,
          frontend: { entry: "frontend/index.ts" },
          capabilities: [],
          has_sky: false,
          has_sky_shader: false,
          has_backend: false,
          has_datasource: false,
        },
      ],
      errors: [],
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  if (pathOnly.startsWith("/api/")) {
    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`));
}

export function installMainEntryMocks(): void {
  MockWebSocket.open = [];
  vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => harnessFetch(input, init)) as typeof fetch);
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
  vi.stubGlobal("requestAnimationFrame", ((_cb: FrameRequestCallback) => 1) as typeof requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  vi.stubGlobal("setTimeout", ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (typeof ms === "number" && ms >= 2000) return 0 as ReturnType<typeof setTimeout>;
    return realSetTimeout(fn, ms, ...args);
  }) as typeof setTimeout);
  stubGl();
}

export type MainEntryHarness = {
  pushState: (msg: StateMsg) => void;
  ws: MockWebSocket;
};

export async function importMainEntryModule(): Promise<void> {
  vi.resetModules();
  installMainEntryMocks();
  mountIndexDom();
  await import("../main.ts");
}

export async function bootMainEntry(): Promise<MainEntryHarness> {
  await importMainEntryModule();
  const ws = await vi.waitUntil(() => MockWebSocket.open.at(-1), { timeout: 8000 });
  await vi.waitUntil(() => document.getElementById("conn")?.classList.contains("ok"), { timeout: 8000 });
  return {
    ws,
    pushState: (msg) => ws.pushState(msg),
  };
}

/** Async IIFE in main.ts finished installPlugins and refreshed the mode list. */
export async function waitEntryBootComplete(): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector(`#mode li[data-value="${HARNESS_PLUGIN_MODE}"]`)).toBeTruthy();
  }, { timeout: 8000 });
}

export function listModeOptionIds(): string[] {
  const root = document.getElementById("mode");
  if (!root) return [];
  const btn = root.querySelector("button.field-btn") as HTMLButtonElement | null;
  btn?.click();
  const ids = [...root.querySelectorAll("li[data-value]")]
    .map((li) => li.getAttribute("data-value"))
    .filter((v): v is string => !!v);
  if (btn?.getAttribute("aria-expanded") === "true") btn.click();
  return ids;
}

export async function pickModeFromUi(modeId: string): Promise<void> {
  const li = await vi.waitUntil(
    () => document.querySelector(`#mode li[data-value="${modeId}"]`) as HTMLLIElement | null,
    { timeout: 3000 },
  );
  li.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
