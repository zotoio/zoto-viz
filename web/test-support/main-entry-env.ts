/**
 * #239: the page main.ts boots into, set up by importing this module for its side effects. A test
 * file imports it and then `import "./main"` statically, so main.ts and everything it pulls in load
 * while the file is collected, not inside a setup hook, where a cold load on a busy box ran over the
 * hook's limit. It sets up what that hook and src/test/setup.ts's beforeEach set up before the old
 * dynamic import: index.html's body without its scripts, the WebSocket stub, the sandbox handshake
 * and the loopback /api stubs. Each test file gets its own module registry, so each one boots once.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { installSandboxTestHandshake, resetSandboxTestHarnessState } from "../src/plugins/sandbox-test-harness";
import { stubApiFetch } from "./api-fetch-stub";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(here, "../index.html"), "utf8");
export const bodyHtml = (indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "").replace(
  /<script[\s\S]*?<\/script>/gi,
  "",
);

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
  close() {}
  addEventListener() {}
}

document.body.innerHTML = bodyHtml;
vi.stubGlobal("WebSocket", MockWebSocket);
resetSandboxTestHarnessState();
installSandboxTestHandshake();
stubApiFetch();
