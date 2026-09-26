/**
 * Revert-proof vitest hook (Vitest 5.0.0).
 *
 * Live Error instances are only visible in VitestRunner.runTask (before
 * failTask → processError serializes them). onTestFailed and onAfterRunTask
 * only see plain serialized objects, so instanceof chai.AssertionError must
 * run here—not in setupFiles onTestFailed.
 */
import { TestRunner, chai } from "vitest";

const { AssertionError } = chai;

export default class RevertProofVitestRunner extends TestRunner {
  async runTask(test) {
    const fn = TestRunner.getTestFn(test);
    try {
      await fn();
    } catch (err) {
      if (err instanceof AssertionError) {
        test.meta.revertProofAssertion = true;
      }
      throw err;
    }
  }
}
