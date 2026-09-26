/**
 * Revert-proof vitest hook (Vitest 5.0.0).
 *
 * Live Error instances are only visible in VitestRunner.runTask (before
 * failTask → processError serializes them). onTestFailed and onAfterRunTask
 * only see plain serialized objects, so instanceof checks must run here—not
 * in setupFiles onTestFailed. Accepts vitest chai.AssertionError and
 * node:assert AssertionError (see revert-proofs/README.md).
 */
import { AssertionError as NodeAssertionError } from "node:assert";
import { TestRunner, chai } from "vitest";

const { AssertionError: ChaiAssertionError } = chai;

/** @param {unknown} err */
export function isRevertProofVitestAssertionError(err) {
  return (
    err instanceof ChaiAssertionError || err instanceof NodeAssertionError
  );
}

export default class RevertProofVitestRunner extends TestRunner {
  async runTask(test) {
    const fn = TestRunner.getTestFn(test);
    try {
      await fn();
    } catch (err) {
      if (isRevertProofVitestAssertionError(err)) {
        test.meta.revertProofAssertion = true;
      }
      throw err;
    }
  }
}
