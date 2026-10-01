import { afterEach, beforeEach, vi } from "vitest";
import { stubApiFetch } from "../../test-support/api-fetch-stub";
import { installSandboxTestHandshake, resetSandboxTestHarnessState } from "../plugins/sandbox-test-harness";

beforeEach(() => {
  resetSandboxTestHarnessState();
  installSandboxTestHandshake();
  stubApiFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});
