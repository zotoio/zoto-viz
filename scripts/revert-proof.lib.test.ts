import { describe, expect, it } from "vitest";
import {
  assessPytestSelection,
  assessVitestSelection,
  classifyPatchedPytest,
  classifyPatchedVitest,
  parsePytestPluginJson,
  parseVitestJsonReport,
} from "./revert-proof-lib.mjs";

const vitestSelection = (
  tests: { fullName: string; status: string; revertProofAssertion?: boolean }[],
  testName: string,
) => ({
  suiteError: null,
  selection: assessVitestSelection(
    tests.map((t) => ({
      fullName: t.fullName,
      status: t.status,
      revertProofAssertion: t.revertProofAssertion === true,
    })),
    testName,
  ),
});

describe("vitest JSON selection by full name", () => {
  it("requires target passed/failed and all others skipped", () => {
    const tests = [
      { fullName: "widget > returns one", status: "failed", revertProofAssertion: true },
      { fullName: "widget > helper ok", status: "skipped", revertProofAssertion: false },
    ];
    const sel = assessVitestSelection(tests, "widget > returns one");
    expect(sel.ok).toBe(true);
  });

  it("rejects when target is skipped (it.skipIf / ctx.skip)", () => {
    const tests = [
      { fullName: "widget > returns one", status: "skipped", revertProofAssertion: false },
      { fullName: "widget > helper ok", status: "skipped", revertProofAssertion: false },
    ];
    const sel = assessVitestSelection(tests, "widget > returns one");
    expect(sel.ok).toBe(false);
    expect(sel.reason).toBe("target skipped");
  });

  it("rejects when another test executed", () => {
    const tests = [
      { fullName: "widget > returns one", status: "failed", revertProofAssertion: true },
      { fullName: "widget > helper ok", status: "passed", revertProofAssertion: false },
    ];
    const sel = assessVitestSelection(tests, "widget > returns one");
    expect(sel.ok).toBe(false);
    expect(sel.reason).toBe("other tests not skipped");
  });
});

describe("strict Vitest red from task.meta only", () => {
  it("accepts revertProofAssertion meta", () => {
    expect(
      classifyPatchedVitest({
        counts: vitestSelection(
          [{ fullName: "suite > test", status: "failed", revertProofAssertion: true }],
          "suite > test",
        ),
      }),
    ).toBe("assertion");
  });

  it("(b) rejects assertion-looking failure without meta flag", () => {
    expect(
      classifyPatchedVitest({
        counts: vitestSelection(
          [{ fullName: "suite > test", status: "failed", revertProofAssertion: false }],
          "suite > test",
        ),
      }),
    ).toBe("build break");
  });

  it("(c) rejects plain-object style failures without meta flag", () => {
    expect(
      classifyPatchedVitest({
        counts: vitestSelection(
          [{ fullName: "d > t", status: "failed", revertProofAssertion: false }],
          "d > t",
        ),
      }),
    ).toBe("build break");
  });

  it("reports a passing patched test as green", () => {
    expect(
      classifyPatchedVitest({
        counts: vitestSelection(
          [{ fullName: "suite > test", status: "passed", revertProofAssertion: false }],
          "suite > test",
        ),
      }),
    ).toBe("green");
  });
});

describe("strict pytest red from plugin JSON only", () => {
  it("(a) rejects ProbeError even when traceback mentions AssertionError", () => {
    const nodeId = "tests/test_x.py::test_y";
    const tests = [
      {
        nodeid: nodeId,
        outcome: "failed",
        revertProofAssertion: false,
      },
    ];
    expect(assessPytestSelection(tests, nodeId).ok).toBe(true);
    expect(
      classifyPatchedPytest({
        counts: {
          collectionError: false,
          selection: assessPytestSelection(tests, nodeId),
        },
      }),
    ).toBe("build break");
  });

  it("accepts revertProofAssertion from plugin JSON", () => {
    const nodeId = "tests/test_x.py::test_y";
    const tests = [
      {
        nodeid: nodeId,
        outcome: "failed",
        revertProofAssertion: true,
      },
    ];
    expect(
      classifyPatchedPytest({
        counts: {
          collectionError: false,
          selection: assessPytestSelection(tests, nodeId),
        },
      }),
    ).toBe("assertion");
  });
});

describe("pytest plugin JSON parsing", () => {
  it("parses tests array from plugin output", () => {
    const parsed = parsePytestPluginJson(
      JSON.stringify({
        tests: [
          { nodeid: "t.py::test_a", outcome: "passed", revertProofAssertion: false },
          { nodeid: "t.py::test_b", outcome: "skipped", revertProofAssertion: false },
        ],
      }),
      0,
    );
    expect(parsed.tests).toHaveLength(2);
    expect(assessPytestSelection(parsed.tests, "t.py::test_a").ok).toBe(true);
    expect(assessPytestSelection(parsed.tests, "t.py::test_b").reason).toBe(
      "target skipped",
    );
  });

  it("treats missing JSON on nonzero exit as collection error", () => {
    const parsed = parsePytestPluginJson("", 2);
    expect(parsed.collectionError).toBe(true);
  });
});

describe("vitest JSON report parsing", () => {
  it("rebuilds fullName from ancestorTitles and reads meta", () => {
    const report = {
      testResults: [
        {
          assertionResults: [
            {
              ancestorTitles: ["widget > alpha"],
              title: "returns one",
              status: "failed",
              meta: { revertProofAssertion: true },
            },
          ],
        },
      ],
    };
    const parsed = parseVitestJsonReport(report);
    expect(parsed.tests[0]?.fullName).toBe("widget > alpha > returns one");
    expect(parsed.tests[0]?.revertProofAssertion).toBe(true);
  });
});
