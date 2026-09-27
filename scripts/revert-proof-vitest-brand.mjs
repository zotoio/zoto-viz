/**
 * Shared branding for revert-proof vitest overlay (imported by setup + runner).
 * Errors are marked only when thrown from a wrapped chai Assertion prototype method.
 * `expect.soft()` failures never leave the matcher (vitest records a serialized copy),
 * so the first branded soft failure per test is kept here for the runner.
 */
export const branded = new WeakSet();

/** Vitest stringifies `actual`/`expected` on recorded errors, so red is captured when branded. */
const redAtBrand = new WeakMap();

/** @type {WeakMap<object, object>} */
const firstSoftFailure = new WeakMap();
let lastBranded = null;

const isObject = (v) => (typeof v === "object" && v !== null) || typeof v === "function";

function brandIfAssertion(err, isAssertion) {
  if (isObject(err) && isAssertion(err)) {
    if (!branded.has(err)) {
      branded.add(err);
      redAtBrand.set(err, {
        actual: "actual" in err ? err.actual : undefined,
        expected: "expected" in err ? err.expected : undefined,
      });
    }
    lastBranded = err;
  }
  return err;
}

function softErrorCount(test) {
  return test?.result?.errors?.length ?? 0;
}

function wrapMethod(orig, isAssertion, flag) {
  return function revertProofBrandedMethod(...args) {
    const softTest = isObject(this) && flag(this, "soft") ? flag(this, "vitest-test") : undefined;
    const before = softErrorCount(softTest);
    lastBranded = null;
    let out;
    try {
      out = Reflect.apply(orig, this, args);
    } catch (e) {
      throw brandIfAssertion(e, isAssertion);
    }
    if (
      isObject(softTest) &&
      lastBranded &&
      softErrorCount(softTest) > before &&
      !firstSoftFailure.has(softTest)
    ) {
      firstSoftFailure.set(softTest, lastBranded);
    }
    if (out && typeof out.then === "function") {
      return out.then(undefined, (e) => {
        throw brandIfAssertion(e, isAssertion);
      });
    }
    return out;
  };
}

/** @param {import("chai").ChaiStatic} chai */
export function installRevertProofChaiBranding(chai) {
  const isChaiAssertion = (e) => e instanceof chai.AssertionError;
  const flag = chai.util.flag;
  const proto = chai.Assertion.prototype;
  for (const key of Reflect.ownKeys(proto)) {
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    if (key === "constructor" || typeof desc?.value !== "function" || !desc.writable) {
      continue;
    }
    proto[key] = wrapMethod(desc.value, isChaiAssertion, flag);
  }
}

/** Returns and clears the first branded `expect.soft()` failure recorded for `test`. */
export function takeSoftFailure(test) {
  const err = firstSoftFailure.get(test) ?? null;
  firstSoftFailure.delete(test);
  return err;
}

/** @param {unknown} err */
export function serializeVitestRed(err) {
  return (isObject(err) && redAtBrand.get(err)) || null;
}
