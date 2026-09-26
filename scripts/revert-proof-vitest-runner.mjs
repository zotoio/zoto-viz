/**
 * Revert-proof vitest hook (Vitest 5.0.0).
 *
 * Red requires an error that a real assertion threw. Errors are branded at the
 * throw site (chai `Assertion.prototype` methods, `node:assert` exports) into a
 * module-private WeakSet; prototype, constructor and `instanceof` alone are
 * never trusted. The verdict lives in a module-private WeakMap and is copied into a
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

function trackRejection(value, passthrough) {
  return value.then(undefined, (e) => {
    if (isObject(e)) passthrough.add(e);
    throw e;
  });
}

function trackBlock(block, passthrough) {
  if (typeof block === "function") {
    return function (...args) {
      try {
        const out = Reflect.apply(block, this, args);
        return out && typeof out.then === "function" ? trackRejection(out, passthrough) : out;
      } catch (e) {
        if (isObject(e)) passthrough.add(e);
        throw e;
      }
    };
  }
  return block && typeof block.then === "function" ? trackRejection(block, passthrough) : block;
}

/**
 * Objects handed to the assertion, and errors thrown by the block of
 * `throws`/`rejects`-style assertions, can be rethrown verbatim; they are
 * never branded.
 */
function wrapAssertion(orig, isAssertion, { tracksBlock = false } = {}) {
  return function revertProofBrandedAssertion(...args) {
    const passthrough = new WeakSet();
    for (const a of args) {
      if (isObject(a)) passthrough.add(a);
    }
    if (tracksBlock && args.length > 0) {
      args[0] = trackBlock(args[0], passthrough);
    }
    let out;
    try {
      out = Reflect.apply(orig, this, args);
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

/**
 * `Assertion#assert` backs chai-style assertions; vitest's jest-style matchers
 * (`toMatchObject`, `toHaveBeenCalledWith`, `toThrow(Class)`, …) are methods on
 * the same prototype and sometimes build their AssertionError directly.
 */
chai.use((c) => {
  const isChaiAssertion = (e) => e instanceof c.AssertionError;
  const proto = c.Assertion.prototype;
  for (const key of Reflect.ownKeys(proto)) {
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    if (key === "constructor" || typeof desc.value !== "function" || !desc.writable) continue;
    proto[key] = wrapAssertion(desc.value, isChaiAssertion);
  }
});

const NODE_ASSERT_SKIP = new Set(["AssertionError", "CallTracker", "Assert", "strict"]);
const NODE_ASSERT_BLOCK = new Set(["throws", "doesNotThrow", "rejects", "doesNotReject"]);

function wrapNodeAssertExports(mod, isNodeAssertion) {
  for (const key of Object.keys(mod)) {
    if (NODE_ASSERT_SKIP.has(key) || typeof mod[key] !== "function") continue;
    mod[key] = wrapAssertion(mod[key], isNodeAssertion, { tracksBlock: NODE_ASSERT_BLOCK.has(key) });
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
