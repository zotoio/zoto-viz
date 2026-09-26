/**
 * Aliased for `node:assert` / `assert` by revert-proof-vitest-overlay.mjs.
 *
 * Node's builtin default export is the unwrappable `ok` function itself, so
 * `assert(false)` would bypass the runner's throw-site branding. This facade
 * is a callable default that delegates to the builtin exports the runner has
 * already wrapped; it brands nothing on its own.
 */
import { createRequire } from "node:module";

const builtin = createRequire(import.meta.url)("node:assert");

function callableFacade(mod) {
  function assert(...args) {
    return Reflect.apply(mod.ok, this, args);
  }
  for (const key of Object.keys(mod)) {
    if (key !== "strict") assert[key] = mod[key];
  }
  return assert;
}

export const strictFacade = callableFacade(builtin.strict);
strictFacade.strict = strictFacade;

const facade = callableFacade(builtin);
facade.strict = strictFacade;

export default facade;
export const {
  AssertionError,
  CallTracker,
  deepEqual,
  deepStrictEqual,
  doesNotMatch,
  doesNotReject,
  doesNotThrow,
  equal,
  fail,
  ifError,
  match,
  notDeepEqual,
  notDeepStrictEqual,
  notEqual,
  notStrictEqual,
  ok,
  partialDeepStrictEqual,
  rejects,
  strict,
  strictEqual,
  throws,
} = facade;
