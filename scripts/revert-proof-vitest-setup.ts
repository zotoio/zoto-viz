/**
 * Injected by revert-proof overlay config (see revert-proof-vitest-overlay.mjs).
 *
 * Vitest 5.0.0 serializes errors before onTestFailed runs, so assertion typing
 * is recorded in revert-proof-vitest-runner.mjs VitestRunner.runTask.
 * This setup file is reserved for runner-owned hooks that must live in the worker.
 */
export {};
