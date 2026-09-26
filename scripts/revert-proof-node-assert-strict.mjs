/** Aliased for `node:assert/strict` / `assert/strict` (see revert-proof-node-assert.mjs). */
import { strictFacade } from "./revert-proof-node-assert.mjs";

export default strictFacade;
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
} = strictFacade;
