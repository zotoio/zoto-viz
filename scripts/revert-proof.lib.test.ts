import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertRedValue,
  assessPytestSelection,
  assessVitestSelection,
  classifyPatchedPytest,
  classifyPatchedVitest,
  parsePytestPluginJson,
  parseVitestJsonReport,
  validateRowMeta,
} from "./revert-proof-lib.mjs";

beforeEach(() => {
  expect.hasAssertions();
});

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

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
      failureMessage: null,
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

  it("rejects when filter matches multiple executed tests", () => {
    const tests = [
      { fullName: "widget > returns one", status: "failed", revertProofAssertion: true },
      { fullName: "widget > returns one", status: "failed", revertProofAssertion: true },
    ];
    const sel = assessVitestSelection(tests, "widget > returns one");
    expect(sel.ok).toBe(false);
    expect(sel.reason).toBe("multiple tests matched filter");
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

const OVERLAY_CASES = `import { afterEach, chai, describe, expect, it, onTestFailed } from "vitest";
import assert from "node:assert";
import strict from "node:assert/strict";
import { AssertionError as NodeAssertionError, strictEqual } from "node:assert";

it("expect toBe", () => {
  expect(1).toBe(0);
});
it("node strictEqual", () => {
  strictEqual(1, 0);
});
it("node callable assert", () => {
  assert(false);
});
it("node strict callable", () => {
  strict(false);
});
it("node strict deepStrictEqual", () => {
  strict.deepStrictEqual({ a: 1 }, { a: 2 });
});
it("plain object", () => {
  throw { name: "AssertionError", message: "expected 1 to be 0" };
});
it("meta body spoof", ({ task }) => {
  task.meta.revertProofAssertion = true;
  throw new TypeError("boom: not an assertion");
});
it("meta onTestFailed spoof", ({ task }) => {
  onTestFailed(() => {
    task.meta.revertProofAssertion = true;
  });
  throw new TypeError("boom: not an assertion");
});
it("meta timer spoof", ({ task }) => {
  setTimeout(() => {
    try {
      task.meta.revertProofAssertion = true;
    } catch {}
  }, 0);
  throw new TypeError("boom: not an assertion");
});
describe("after", () => {
  afterEach(({ task }) => {
    task.meta.revertProofAssertion = true;
  });
  it("meta afterEach spoof", () => {
    throw new TypeError("boom: not an assertion");
  });
});
it("proto borrow", () => {
  throw Object.setPrototypeOf(new TypeError("boom"), chai.AssertionError.prototype);
});
it("hand-built chai", () => {
  throw new chai.AssertionError("fake");
});
it("hand-built node", () => {
  throw new NodeAssertionError({ message: "fake" });
});
it("chai subclass", () => {
  class Fake extends chai.AssertionError {}
  throw new Fake("fake");
});
it("node fail passthrough", () => {
  assert.fail(new NodeAssertionError({ message: "fake" }) as unknown as string);
});
it("node rejects passthrough", async () => {
  const fake = Object.setPrototypeOf(new TypeError("boom"), NodeAssertionError.prototype);
  await assert.rejects(Promise.reject(fake), (e) => {
    throw e;
  });
});
`;

function vitestBin() {
  for (const rel of ["web/node_modules/.bin/vitest", "node_modules/.bin/vitest"]) {
    const bin = path.join(repoRoot, rel);
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error(`vitest binary not found under ${repoRoot}`);
}

/** Runs OVERLAY_CASES through the real revert-proof overlay; returns task.meta flag per test title. */
function runOverlayCases(): Record<string, boolean> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-overlay-"));
  try {
    fs.writeFileSync(path.join(dir, "cases.test.ts"), OVERLAY_CASES);
    fs.writeFileSync(
      path.join(dir, "base.config.mjs"),
      `export default ${JSON.stringify({
        root: dir,
        cacheDir: path.join(dir, ".vite"),
        test: { environment: "node", include: [path.join(dir, "*.test.ts")] },
      })};\n`,
    );
    const out = path.join(dir, "report.json");
    const r = spawnSync(
      vitestBin(),
      [
        "run",
        "--root",
        dir,
        "--config",
        path.join(scriptsDir, "revert-proof-vitest-overlay.mjs"),
        "--reporter=json",
        `--outputFile.json=${out}`,
      ],
      {
        cwd: path.join(repoRoot, "web"),
        encoding: "utf8",
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          REVERT_PROOF_ROOT: repoRoot,
          REVERT_PROOF_VITEST_BASE_CONFIG: path.join(dir, "base.config.mjs"),
        },
      },
    );
    if (!fs.existsSync(out)) {
      throw new Error(`overlay vitest wrote no JSON report: ${r.stderr || r.stdout}`);
    }
    const flags: Record<string, boolean> = {};
    for (const t of parseVitestJsonReport(JSON.parse(fs.readFileSync(out, "utf8"))).tests) {
      if (t.status !== "failed") {
        throw new Error(`overlay case ${t.fullName} did not fail (${t.status})`);
      }
      flags[t.fullName] = t.revertProofAssertion;
    }
    return flags;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("revert-proof vitest runner through the overlay", () => {
  let flags: Record<string, boolean> = {};

  beforeAll(() => {
    flags = runOverlayCases();
  }, 120_000);

  it("(f) real expect() failure sets revertProofAssertion", () => {
    expect(flags["expect toBe"]).toBe(true);
  });

  it("(g) node:assert strictEqual failure sets revertProofAssertion", () => {
    expect(flags["node strictEqual"]).toBe(true);
  });

  it("(g-callable) callable node:assert and node:assert/strict failures set revertProofAssertion", () => {
    for (const name of [
      "node callable assert",
      "node strict callable",
      "node strict deepStrictEqual",
    ]) {
      expect(flags[name], name).toBe(true);
    }
  });

  it("(c) plain-object fake AssertionError is rejected", () => {
    expect(flags["plain object"]).toBe(false);
  });

  it("(meta-spoof) test-written task.meta.revertProofAssertion is overwritten", () => {
    for (const name of [
      "meta body spoof",
      "meta onTestFailed spoof",
      "meta timer spoof",
      "after > meta afterEach spoof",
    ]) {
      expect(flags[name], name).toBe(false);
    }
  });

  it("(proto-borrow) borrowed prototypes, hand-built and subclassed AssertionErrors are rejected", () => {
    for (const name of ["proto borrow", "hand-built chai", "hand-built node", "chai subclass"]) {
      expect(flags[name], name).toBe(false);
    }
  });

  it("(passthrough) errors handed to an assertion and rethrown are not branded", () => {
    for (const name of ["node fail passthrough", "node rejects passthrough"]) {
      expect(flags[name], name).toBe(false);
    }
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

  it("(c-meta) rejects plain-object style failures without meta flag", () => {
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

  it("(red-line) keeps the first line of the first failure message", () => {
    const parsed = parseVitestJsonReport({
      testResults: [
        {
          assertionResults: [
            {
              ancestorTitles: ["widget"],
              title: "returns one",
              status: "failed",
              failureMessages: [
                "AssertionError: expected 2 to be 1 // Object.is equality\n    at widget.test.ts:5:21",
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.tests[0]?.failureMessage).toBe(
      "AssertionError: expected 2 to be 1 // Object.is equality",
    );
  });
});

describe("sidecar red value", () => {
  const meta = {
    runner: "vitest",
    testFile: "scripts/x.test.ts",
    testName: "x > y",
    description: "d",
  };

  it("(red-required) sidecar without a string red field is rejected", () => {
    expect(() => validateRowMeta(meta, "r")).toThrow(
      new Error('row r: sidecar JSON missing string field "red"'),
    );
  });

  it("(red-mismatch) a different patched failure line is rejected", () => {
    expect(() =>
      assertRedValue(
        "r",
        "AssertionError: expected 2 to be 1 // Object.is equality",
        "AssertionError: expected 3 to be 1 // Object.is equality",
      ),
    ).toThrow(
      new Error(
        "row r: red value mismatch (expected AssertionError: expected 2 to be 1 // Object.is equality, got AssertionError: expected 3 to be 1 // Object.is equality)",
      ),
    );
  });
});
