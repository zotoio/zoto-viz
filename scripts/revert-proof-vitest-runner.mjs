/**
 * Revert-proof vitest runner (Vitest 5.0.0).
 *
 * Only this module writes revertProofAssertion / revertProofRed on task.meta, and only
 * in onAfterRunTask after hooks finish (frozen meta). Verdict uses branded WeakSet from
 * setupFile-wrapped chai assertions.
 */
import { TestRunner } from "vitest";
import { branded, serializeVitestRed, takeSoftFailure } from "./revert-proof-vitest-brand.mjs";

const verdict = new WeakMap();
/** @type {WeakMap<import("vitest").Task, { actual: unknown, expected: unknown } | null>} */
const firstRed = new WeakMap();

const isObject = (v) => (typeof v === "object" && v !== null) || typeof v === "function";

function noteFailure(test, err) {
  if (verdict.has(test)) {
    return;
  }
  if (!isObject(err) || !branded.has(err)) {
    verdict.set(test, false);
    return;
  }
  verdict.set(test, true);
  firstRed.set(test, serializeVitestRed(err));
}

export default class RevertProofVitestRunner extends TestRunner {
  async runTask(test) {
    verdict.delete(test);
    firstRed.delete(test);
    takeSoftFailure(test);
    const fn = TestRunner.getTestFn(test);
    let threw = false;
    let thrown;
    try {
      await fn();
    } catch (err) {
      threw = true;
      thrown = err;
    }
    const soft = takeSoftFailure(test);
    if (soft) {
      noteFailure(test, soft);
    }
    if (threw) {
      noteFailure(test, thrown);
      throw thrown;
    }
  }

  onAfterRunTask(test) {
    const revertProofAssertion = verdict.get(test) === true;
    const revertProofRed = firstRed.get(test) ?? null;
    verdict.delete(test);
    firstRed.delete(test);
    test.meta = Object.freeze({
      ...test.meta,
      revertProofAssertion,
      revertProofRed,
    });
    return super.onAfterRunTask(test);
  }
}
