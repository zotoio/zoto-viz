import { describe, expect, it } from "vitest";
import {
  classifyPatchedPytest,
  classifyPatchedVitest,
  isPytestAssertionBody,
  isVitestAssertionFailure,
  isVitestJunitSkipped,
  parsePytestJunit,
  vitestJunitFailureType,
} from "./revert-proof-lib.mjs";

const vitestCounts = (failed = 1) => ({
  executed: 1,
  passed: failed ? 0 : 1,
  failed,
  suiteError: null,
  failedAssertions: [],
  ranTests: [{ fullName: "suite > test", status: failed ? "failed" : "passed" }],
});

describe("strict Vitest red classification", () => {
  it("accepts one JUnit AssertionError", () => {
    const junitXml =
      '<testsuite><testcase name="test"><failure type="AssertionError">expected 1 to be 2</failure></testcase></testsuite>';
    expect(isVitestAssertionFailure([], junitXml)).toBe(true);
    expect(
      classifyPatchedVitest({ counts: vitestCounts(), junitXml }),
    ).toBe("assertion");
  });

  it("rejects assertion-looking text without the JUnit type", () => {
    const junitXml =
      '<testsuite><testcase name="test"><failure message="AssertionError">not typed</failure></testcase></testsuite>';
    expect(isVitestAssertionFailure([], junitXml)).toBe(false);
    expect(
      classifyPatchedVitest({ counts: vitestCounts(), junitXml }),
    ).toBe("build break");
  });

  it("rejects non-assertion exception types", () => {
    const junitXml =
      '<testsuite><testcase name="test"><failure type="RangeError">Expected 1 to be 2</failure></testcase></testsuite>';
    expect(vitestJunitFailureType(junitXml)).toBe("RangeError");
    expect(
      classifyPatchedVitest({ counts: vitestCounts(), junitXml }),
    ).toBe("build break");
  });

  it("reports a passing patched test as green", () => {
    expect(classifyPatchedVitest({ counts: vitestCounts(0) })).toBe("green");
  });

  it("does not count skipped JUnit cases as failures", () => {
    const junitXml = `<testsuite>
      <testcase name="filtered"><skipped/></testcase>
      <testcase name="test"><failure type="AssertionError">no</failure></testcase>
    </testsuite>`;
    expect(vitestJunitFailureType(junitXml)).toBe("AssertionError");
  });

  it("recognizes body and attribute skip encodings", () => {
    expect(isVitestJunitSkipped("", "<skipped/>")).toBe(true);
    expect(isVitestJunitSkipped(' status="pending"', "")).toBe(true);
    expect(isVitestJunitSkipped(' skipped="true"', "")).toBe(true);
    expect(isVitestJunitSkipped(' status="failed"', "<failure/>")).toBe(false);
  });
});

describe("strict pytest red classification", () => {
  it("accepts AssertionError type or message", () => {
    expect(
      isPytestAssertionBody('<failure type="AssertionError">no</failure>'),
    ).toBe(true);
    expect(
      isPytestAssertionBody('<failure message="AssertionError: no">no</failure>'),
    ).toBe(true);
    expect(
      isPytestAssertionBody('<failure message="assert 1 == 2">no</failure>'),
    ).toBe(true);
  });

  it("rejects assertion words in exception bodies and tracebacks", () => {
    expect(
      isPytestAssertionBody(
        '<failure message="service.ProbeError: bad"># AssertionError</failure>',
      ),
    ).toBe(false);
    expect(
      isPytestAssertionBody(
        '<failure message="TypeError: boom">assert False\nTypeError: boom</failure>',
      ),
    ).toBe(false);
  });

  it("classifies errors and non-assertion failures as build breaks", () => {
    expect(
      classifyPatchedPytest({
        counts: {
          collectionError: false,
          cases: [{ name: "t", outcome: "error", body: "AttributeError" }],
        },
      }),
    ).toBe("build break");
    expect(
      classifyPatchedPytest({
        counts: {
          collectionError: false,
          cases: [
            {
              name: "t",
              outcome: "failed",
              body: '<failure message="AttributeError: boom"/>',
            },
          ],
        },
      }),
    ).toBe("build break");
  });
});

describe("pytest JUnit execution counts", () => {
  it("keeps a self-closing pass before a failure", () => {
    const parsed = parsePytestJunit(
      `<testsuite>
        <testcase name="pass"/>
        <testcase name="fail"><failure message="assert 1 == 2"/></testcase>
      </testsuite>`,
      1,
    );
    expect(parsed.executed).toBe(2);
    expect(parsed.cases.map((test) => test.outcome)).toEqual(["passed", "failed"]);
  });

  it("excludes skipped cases from the executed count", () => {
    const parsed = parsePytestJunit(
      `<testsuite>
        <testcase name="pass"/>
        <testcase name="skip"><skipped/></testcase>
      </testsuite>`,
      0,
    );
    expect(parsed.executed).toBe(1);
    expect(parsed.cases[0]?.name).toBe("pass");
  });

  it("treats a nonzero run without cases as collection failure", () => {
    const parsed = parsePytestJunit("", 2);
    expect(parsed.executed).toBe(0);
    expect(parsed.collectionError).toBe(true);
  });
});
