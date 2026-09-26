/**
 * Revert-proof vitest hook (Vitest 5.0.0).
 *
 * Red requires an error that a real assertion threw. Errors are branded at the
 * throw site (chai `Assertion.prototype.assert`, `node:assert` exports) into a
 * module-private WeakSet; prototype, constructor and `instanceof` are never
 * trusted. The verdict lives in a module-private WeakMap and is copied into a
 * frozen `task.meta` only in onAfterRunTask, after every test hook has run, so
 * test code cannot set `revertProofAssertion` itself.
 */
import { createRequire, syncBuiltinESMExports } from "node:module";
import { TestRunner, chai } from "vitest";

const branded = new WeakSet();
const verdict = new WeakMap();

const isObject = (v) => (typeof v === "object" && v !== null) || typeof v === "function";

function brandIfThrownByAssertion(err, isAssertion, passthrough) {
  if (isObject(err) && isAssertion(err) && !passthrough.has(err)) {
    branded.add(err);
  }
  return err;
}

/**
 * Errors handed to the assertion (arguments, or thrown/rejected by callback
 * arguments such as `assert.throws(fn)`) can be rethrown verbatim; they are
 * never branded.
 */
function wrapAssertion(orig, isAssertion) {
  return function revertProofBrandedAssertion(...args) {
    const passthrough = new WeakSet();
    const tracked = args.map((a) => {
      if (isObject(a)) passthrough.add(a);
      if (typeof a === "function") {
        return function (...inner) {
          try {
            const out = Reflect.apply(a, this, inner);
            if (out && typeof out.then === "function") {
              return out.then(undefined, (e) => {
                if (isObject(e)) passthrough.add(e);
                throw e;
              });
            }
            return out;
          } catch (e) {
            if (isObject(e)) passthrough.add(e);
            throw e;
          }
        };
      }
      if (a && typeof a.then === "function") {
        return a.then(undefined, (e) => {
          if (isObject(e)) passthrough.add(e);
          throw e;
        });
      }
      return a;
    });
    let out;
    try {
      out = Reflect.apply(orig, this, tracked);
    } catch (e) {
      throw brandIfThrownByAssertion(e, isAssertion, passthrough);
    }
    if (out && typeof out.then === "function") {
      return out.then(undefined, (e) => {
        throw brandIfThrownByAssertion(e, isAssertion, passthrough);
      });
    }
    return out;
  };
}

chai.use((c) => {
  const isChaiAssertion = (e) => e instanceof c.AssertionError;
  c.Assertion.prototype.assert = wrapAssertion(c.Assertion.prototype.assert, isChaiAssertion);
});

const NODE_ASSERT_SKIP = new Set(["AssertionError", "CallTracker", "Assert", "strict"]);

function wrapNodeAssertExports(mod, isNodeAssertion) {
  for (const key of Object.keys(mod)) {
    if (NODE_ASSERT_SKIP.has(key) || typeof mod[key] !== "function") continue;
    mod[key] = wrapAssertion(mod[key], isNodeAssertion);
  }
}

const nodeRequire = createRequire(import.meta.url);
const nodeAssert = nodeRequire("node:assert");
const isNodeAssertion = (e) => e instanceof nodeAssert.AssertionError;
wrapNodeAssertExports(nodeAssert, isNodeAssertion);
wrapNodeAssertExports(nodeAssert.strict, isNodeAssertion);
syncBuiltinESMExports();

export default class RevertProofVitestRunner extends TestRunner {
  async runTask(test) {
    verdict.delete(test);
    const fn = TestRunner.getTestFn(test);
    try {
      await fn();
    } catch (err) {
      verdict.set(test, isObject(err) && branded.has(err));
      throw err;
    }
  }

  onAfterRunTask(test) {
    const revertProofAssertion = verdict.get(test) === true;
    verdict.delete(test);
    test.meta = Object.freeze({ ...test.meta, revertProofAssertion });
    return super.onAfterRunTask(test);
  }
}
