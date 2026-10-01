import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRedLine,
  assertVitestNodeAssertFailClosed,
  assessPytestSelection,
  assessVitestSelection,
  classifyPatchedPytest,
  classifyPatchedVitest,
  gitApplyPatchStrict,
  vitestTargetForbiddenSkipReason,
  parsePytestPluginJson,
  parseVitestJsonReport,
  validateRowMeta,
} from "./revert-proof-lib.mjs";

beforeEach(() => {
  expect.hasAssertions();
});

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const strictGitApplySamplePatch = path.join(
  scriptsDir,
  "fixtures",
  "strict-git-apply-sample.patch",
);

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

describe("vitest forbidden skip scan (#119)", () => {
  const testName = "widget > returns one";

  it("flags it.skip", () => {
    const src = `describe("widget", () => { it.skip("returns one", () => {}); });`;
    expect(vitestTargetForbiddenSkipReason(src, testName)).toBe("it.skip");
  });

  it("flags it.skip.each", () => {
    const src = `describe("widget", () => { it.skip.each([1])("returns one", () => {}); });`;
    expect(vitestTargetForbiddenSkipReason(src, testName)).toBe("it.skip.each");
  });

  it("flags test.skipIf", () => {
    const src = `describe("widget", () => { test.skipIf(true)("returns one", () => {}); });`;
    expect(vitestTargetForbiddenSkipReason(src, testName)).toBe("test.skipIf");
  });

  it("flags describe.skipIf", () => {
    const src = `describe.skipIf(true)("widget", () => { it("returns one", () => {}); });`;
    expect(vitestTargetForbiddenSkipReason(src, testName)).toBe("describe.skipIf");
  });

  it("flags single-line it.skipIf three-arg", () => {
    const src = `describe("widget", () => { it.skipIf(true, "returns one", () => {}); });`;
    expect(vitestTargetForbiddenSkipReason(src, testName)).toBe("it.skipIf three-arg");
  });

  it("flags it.skipIf with space before paren", () => {
    const src = `describe("widget", () => { it.skipIf (true, "returns one", () => {}); });`;
    expect(vitestTargetForbiddenSkipReason(src, testName)).toBe("it.skipIf space");
  });

  it("flags curried it.skipIf (reordered condition)", () => {
    const src = `describe("widget", () => { it.skipIf(true)("returns one", () => {}); });`;
    expect(vitestTargetForbiddenSkipReason(src, testName)).toBe("it.skipIf curried");
  });
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

function runSingleOverlayCase(
  describeTitle: string,
  innerTestSource: string,
  leafTitle: string,
  topImports = "",
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-overlay-one-"));
  try {
    const content = `import { describe, expect, it } from "vitest";
${topImports}
describe(${JSON.stringify(describeTitle)}, () => {
${innerTestSource}
});
`;
    fs.writeFileSync(path.join(dir, "case.test.ts"), content);
    fs.writeFileSync(
      path.join(dir, "base.config.mjs"),
      `export default ${JSON.stringify({
        root: dir,
        cacheDir: path.join(dir, ".vite"),
        test: { environment: "node", include: [path.join(dir, "*.test.ts")] },
      })};\n`,
    );
    const out = path.join(dir, "report.json");
    const fullName = `${describeTitle} > ${leafTitle}`;
    const r = spawnSync(
      vitestBin(),
      [
        "run",
        "--root",
        dir,
        "--config",
        path.join(scriptsDir, "revert-proof-vitest-overlay.mjs"),
        "-t",
        `^${fullName.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}$`,
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
      throw new Error(`overlay case wrote no JSON: ${r.stderr || r.stdout}`);
    }
    const parsed = parseVitestJsonReport(JSON.parse(fs.readFileSync(out, "utf8")));
    const row = parsed.tests.find((t) => t.fullName === fullName);
    if (!row || row.status !== "failed") {
      throw new Error(`overlay case ${fullName} did not fail (${row?.status})`);
    }
    return row;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function vitestBin() {
  for (const rel of ["web/node_modules/.bin/vitest", "node_modules/.bin/vitest"]) {
    const bin = path.join(repoRoot, rel);
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error(`vitest binary not found under ${repoRoot}`);
}

describe("revert-proof vitest runner through the overlay", () => {
  it("(1) only the runner writes the flag after hooks (meta spoof rejected)", () => {
    const row = runSingleOverlayCase(
      "runner meta",
      `  it("meta body spoof", ({ task }) => {
    task.meta.revertProofAssertion = true;
    task.meta.revertProofRed = { actual: 1, expected: 0 };
    throw new TypeError("boom");
  });`,
      "meta body spoof",
    );
    expect(row.revertProofAssertion).toBe(false);
    expect(row.revertProofRed).toBeNull();
  });

  it("(2) real expect(1).toBe(0) is branded", () => {
    const row = runSingleOverlayCase(
      "expect red",
      `  it("expect toBe", () => {
    expect(1).toBe(0);
  });`,
      "expect toBe",
    );
    expect(row.revertProofAssertion).toBe(true);
    expect(row.revertProofRed).toEqual({ actual: 1, expected: 0 });
  });

  it("(2) plain TypeError is not branded", () => {
    const row = runSingleOverlayCase(
      "type error",
      `  it("plain TypeError", () => {
    throw new TypeError("boom");
  });`,
      "plain TypeError",
    );
    expect(row.revertProofAssertion).toBe(false);
  });

  it("(3) real node:assert strictEqual is not branded", () => {
    const row = runSingleOverlayCase(
      "node assert",
      `  it("node assert strictEqual", () => {
    assert.strictEqual(1, 0);
  });`,
      "node assert strictEqual",
      `import assert from "node:assert";\n`,
    );
    expect(row.revertProofAssertion).toBe(false);
    expect(row.revertProofNodeAssert).toBe(true);
    expect(() => assertVitestNodeAssertFailClosed("node-assert-not-branded", row)).toThrow(
      "row node-assert-not-branded: red is not from expect; node:assert is not supported",
    );
  });

  it("(2) expect.soft failure is branded", () => {
    const row = runSingleOverlayCase(
      "expect soft",
      `  it("soft fail", () => {
    expect.soft(1).toBe(0);
    expect(1).toBe(1);
  });`,
      "soft fail",
    );
    expect(row.revertProofAssertion).toBe(true);
    expect(row.revertProofRed).toEqual({ actual: 1, expected: 0 });
  });

  it("(2) expect.soft failure then TypeError keeps the first (soft) red", () => {
    const row = runSingleOverlayCase(
      "soft fail then throw",
      `  it("soft fail then TypeError", () => {
    expect.soft(2).toBe(3);
    throw new TypeError("after soft");
  });`,
      "soft fail then TypeError",
    );
    expect(row.revertProofAssertion).toBe(true);
    expect(row.revertProofRed).toEqual({ actual: 2, expected: 3 });
  });

  it("(2) expect.soft pass then TypeError is not branded", () => {
    const row = runSingleOverlayCase(
      "soft then throw",
      `  it("soft pass then TypeError", () => {
    expect.soft(1).toBe(1);
    throw new TypeError("after soft");
  });`,
      "soft pass then TypeError",
    );
    expect(row.revertProofAssertion).toBe(false);
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
  it("(4) accepts rewritten assert, rejects hand-raised AssertionError", () => {
    const assertRow = assessPytestSelection(
      [
        {
          nodeid: "tests/t.py::test_ok",
          outcome: "failed",
          revertProofAssertion: true,
          revertProofRed: { assert: "assert answer == 2" },
        },
      ],
      "tests/t.py::test_ok",
    );
    expect(assertRow.ok).toBe(true);
    const raiseRow = assessPytestSelection(
      [
        {
          nodeid: "tests/t.py::test_bad",
          outcome: "failed",
          revertProofAssertion: false,
          revertProofRed: null,
        },
      ],
      "tests/t.py::test_bad",
    );
    expect(classifyPatchedPytest({ counts: { collectionError: false, selection: raiseRow } })).toBe(
      "build break",
    );
  });

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

function pythonBin() {
  return process.env.REVERT_PROOF_PYTHON ?? path.join(repoRoot, ".venv", "bin", "python");
}

function runPytestPluginCase(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-pytest-one-"));
  try {
    fs.writeFileSync(path.join(dir, "test_case.py"), `def test_case():\n${body}\n`);
    const out = path.join(dir, "report.json");
    const r = spawnSync(
      pythonBin(),
      [
        "-m",
        "pytest",
        "-p",
        "no:cacheprovider",
        "-p",
        "revert_proof_pytest_plugin",
        "--rootdir",
        dir,
        "test_case.py::test_case",
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: scriptsDir,
          PYTHONDONTWRITEBYTECODE: "1",
          REVERT_PROOF_PYTEST_JSON: out,
        },
      },
    );
    if (!fs.existsSync(out)) {
      throw new Error(`pytest plugin case wrote no JSON: ${r.stderr || r.stdout}`);
    }
    const parsed = parsePytestPluginJson(fs.readFileSync(out, "utf8"), r.status ?? 1);
    return assessPytestSelection(parsed.tests, "test_case.py::test_case").target;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("revert-proof pytest plugin", () => {
  it("(4-plugin) a failing rewritten assert records its source line as red", () => {
    expect(runPytestPluginCase("    answer = 1\n    assert answer == 2")).toEqual({
      nodeid: "test_case.py::test_case",
      outcome: "failed",
      revertProofAssertion: true,
      revertProofRed: { assert: "assert answer == 2" },
    });
  });

  it("(4-plugin) a hand-raised AssertionError is not an assertion", () => {
    expect(runPytestPluginCase('    raise AssertionError("answer == 2")')).toEqual({
      nodeid: "test_case.py::test_case",
      outcome: "failed",
      revertProofAssertion: false,
      revertProofRed: null,
    });
  });
});

describe("pytest plugin JSON parsing", () => {
  it("selection target carries structured revertProofRed from plugin JSON", () => {
    const parsed = parsePytestPluginJson(
      JSON.stringify({
        tests: [
          {
            nodeid: "t.py::test_a",
            outcome: "failed",
            revertProofAssertion: true,
            revertProofRed: { assert: "assert answer == 2" },
          },
        ],
      }),
      1,
    );
    expect(assessPytestSelection(parsed.tests, "t.py::test_a").target?.revertProofRed).toEqual({
      assert: "assert answer == 2",
    });
  });

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

  it("reads structured revertProofRed from task meta", () => {
    const parsed = parseVitestJsonReport({
      testResults: [
        {
          assertionResults: [
            {
              ancestorTitles: ["widget"],
              title: "returns one",
              status: "failed",
              meta: { revertProofAssertion: true, revertProofRed: { actual: 2, expected: 1 } },
            },
          ],
        },
      ],
    });
    expect(parsed.tests[0]?.revertProofRed).toEqual({ actual: 2, expected: 1 });
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

function thrownMessage(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return undefined;
}

describe("strict git apply", () => {
  const strictApplyTemps: string[] = [];

  afterEach(() => {
    for (const root of strictApplyTemps.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function strictApplyRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-strict-apply-"));
    strictApplyTemps.push(root);
    const fixtureDir = path.join(root, "scripts", "fixtures");
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.copyFileSync(
      path.join(scriptsDir, "fixtures", "strict-git-apply-sample.txt"),
      path.join(fixtureDir, "strict-git-apply-sample.txt"),
    );
    return root;
  }

  it("(strict) accepts a patch with exact context", () => {
    const root = strictApplyRoot();
    if (!fs.existsSync(strictGitApplySamplePatch)) {
      throw new Error(`missing fixture patch: ${strictGitApplySamplePatch}`);
    }
    const patch = fs.readFileSync(strictGitApplySamplePatch, "utf8");
    expect(() => gitApplyPatchStrict(root, patch)).not.toThrow();
  });

  it("(strict) rejects patches that only apply at an offset", () => {
    const root = strictApplyRoot();
    if (!fs.existsSync(strictGitApplySamplePatch)) {
      throw new Error(`missing fixture patch: ${strictGitApplySamplePatch}`);
    }
    const good = fs.readFileSync(strictGitApplySamplePatch, "utf8");
    const stalePatch = good.replace(
      /@@ -(\d+),(\d+) \+(\d+),\2 @@/,
      (_, start, count, plusStart) =>
        `@@ -${Number(start) + 10},${count} +${Number(plusStart) + 10},${count} @@`,
    );
    expect(() => gitApplyPatchStrict(root, stalePatch)).toThrow(/offset or fuzz/i);
  });
});

describe("revert-proofs directory guards", () => {
  it("(dir-child-scope) child must not edit parent revert-proofs tree", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    expect(
      thrownMessage(() =>
        lib.validateStackedChildProofScope("85", "48", [
          "revert-proofs/48/wrong.json",
        ]),
      ),
    ).toBe(
      "stacked PR 85: must not edit parent revert-proofs/48/ (revert-proofs/48/wrong.json)",
    );
    expect(() =>
      lib.validateStackedChildProofScope("85", "48", [
        "revert-proofs/85/ok.json",
      ]),
    ).not.toThrow();
  });

  it("(dir-wrong-pr) sidecar proofPr must match runner PR", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    expect(
      thrownMessage(() => lib.validateRowProofPr({ proofPr: 49 }, "r", "48")),
    ).toBe("row r: sidecar proofPr 49 does not match runner PR 48");
  });

  it("(dir-merge-main) child must merge main after parent squash", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const runGit = (_root: string, args: string[]) => {
      if (args[0] === "show" && args[1] === "main:revert-proofs/48/README.md") {
        return { status: 0, stdout: "# ok\n", stderr: "" };
      }
      if (args[0] === "show" && args[1] === "HEAD:revert-proofs/48/README.md") {
        return { status: 1, stdout: "", stderr: "missing" };
      }
      return { status: 1, stdout: "", stderr: "" };
    };
    expect(
      thrownMessage(() =>
        lib.validateChildBranchIncludesParentProofsOnMain("/r", "85", "48", {
          runGit,
        }),
      ),
    ).toBe(
      "stacked PR 85: parent revert-proofs/48/ is on main but missing at HEAD — merge main into this branch",
    );
  });
});

const TREE_KEY_GIT = ["-c", "user.name=rp-tree", "-c", "user.email=rp-tree@test"];

function treeKeyGit(cwd: string, args: string[]) {
  const r = spawnSync("git", [...TREE_KEY_GIT, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

describe("revert-proof head record tree key", () => {
  it("(tree-key) head record treeKey ignores revert-proofs-only delta", async () => {
    const { computeRevertProofTreeKey } = await import("./revert-proof-lib.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-tree-key-"));
    try {
      fs.mkdirSync(path.join(root, "prod"), { recursive: true });
      fs.writeFileSync(path.join(root, "prod", "app.txt"), "v1\n");
      fs.mkdirSync(path.join(root, "revert-proofs", "99"), { recursive: true });
      fs.writeFileSync(path.join(root, "revert-proofs", "99", "note.txt"), "a\n");
      treeKeyGit(root, ["init", "-b", "main"]);
      treeKeyGit(root, ["add", "."]);
      treeKeyGit(root, ["commit", "-m", "base"]);
      fs.writeFileSync(path.join(root, "revert-proofs", "99", "note.txt"), "b\n");
      treeKeyGit(root, ["add", "revert-proofs/99/note.txt"]);
      treeKeyGit(root, ["commit", "-m", "proofs only"]);
      const kParent = computeRevertProofTreeKey(root, "HEAD~1");
      const kHead = computeRevertProofTreeKey(root, "HEAD");
      expect(kParent).toBe(kHead);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("(tree-key) stacked parent revert-proofs on child head does not change key", async () => {
    const { computeRevertProofTreeKey } = await import("./revert-proof-lib.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-tree-stack-"));
    try {
      fs.mkdirSync(path.join(root, "web", "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "web", "src", "app.ts"), "export const v = 1;\n");
      treeKeyGit(root, ["init", "-b", "main"]);
      treeKeyGit(root, ["add", "."]);
      treeKeyGit(root, ["commit", "-m", "prod"]);
      fs.mkdirSync(path.join(root, "revert-proofs", "48"), { recursive: true });
      fs.mkdirSync(path.join(root, "revert-proofs", "85"), { recursive: true });
      fs.writeFileSync(path.join(root, "revert-proofs", "48", "parent.txt"), "p1\n");
      fs.writeFileSync(path.join(root, "revert-proofs", "85", "child.txt"), "c1\n");
      treeKeyGit(root, ["add", "revert-proofs"]);
      treeKeyGit(root, ["commit", "-m", "child proofs"]);
      const kBefore = computeRevertProofTreeKey(root, "HEAD");
      fs.writeFileSync(path.join(root, "revert-proofs", "48", "parent.txt"), "p2\n");
      treeKeyGit(root, ["add", "revert-proofs/48/parent.txt"]);
      treeKeyGit(root, ["commit", "-m", "touch parent proofs only"]);
      const kAfter = computeRevertProofTreeKey(root, "HEAD");
      expect(kBefore).toBe(kAfter);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("(tree-key) tree-mismatch message is exact", async () => {
    const { formatRevertProofTreeMismatch } = await import("./revert-proof-lib.mjs");
    expect(formatRevertProofTreeMismatch("a".repeat(40), "b".repeat(40))).toBe(
      `revert-proof tree-mismatch: recorded ${"a".repeat(40)} != live ${"b".repeat(40)}`,
    );
  });
});

describe("revert-proof self-test checkout isolation (#128 catch-up)", () => {
  it("(option-b) self-test does not read catch-up proof trees from checkout (e.g. revert-proofs/48/)", () => {
    // After #128, main may ship baseline folders (102/, 112/, 95/) but not every merged PR’s tree.
    expect(fs.existsSync(path.join(repoRoot, "revert-proofs", "48"))).toBe(false);
    // Row proofs in this bundle use temp git fixtures under os.tmpdir(), not `git ls-files revert-proofs`.
  });
});

describe("revert-proof CI gate (item 9)", () => {
  it("(ci-base) stale checkout-proof lib.test at base skips until fixtures land on main", async () => {
    const { decideBaseSelftestStep, SELFTEST_MARKER } = await import("./revert-proof-ci-gate.mjs");
    const baseSha = "aabbccdd";
    const decision = decideBaseSelftestStep(
      (p: string) =>
        p === `${baseSha}:${SELFTEST_MARKER}` || p === `${baseSha}:scripts/revert-proof.lib.test.ts`,
      baseSha,
      () => true,
      (p: string) =>
        p.endsWith("revert-proof.lib.test.ts")
          ? "revert-proofs/48/classify-rejects-plain-meta.patch"
          : "",
    );
    expect(decision.action).toBe("skip");
    expect(decision.case).toBe("base_stale_selftest_bundle");
  });

  it("(ci-base) when base has the self-test marker, skip is refused (must run)", async () => {
    const { decideBaseSelftestStep, SELFTEST_MARKER } = await import("./revert-proof-ci-gate.mjs");
    const baseSha = "deadbeef";
    const gitPath = `${baseSha}:${SELFTEST_MARKER}`;
    const decision = decideBaseSelftestStep((p: string) => p === gitPath, baseSha, () => true, () => "");
    expect(decision.action).toBe("run");
    expect(decision.case).toBe("base_has_marker");
    expect(decision.check).toBe(`git cat-file -e ${gitPath}`);
    expect(decision.result).toBe("present");
  });

  it("(ci-base) when base lacks the self-test marker, skip is allowed for a real commit", async () => {
    const { decideBaseSelftestStep } = await import("./revert-proof-ci-gate.mjs");
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout
      .trim();
    const decision = decideBaseSelftestStep(
      () => false,
      head,
      (ref: string) => ref === `${head}^{commit}`,
      () => "",
    );
    expect(decision.action).toBe("skip");
    expect(decision.case).toBe("base_missing_marker");
    expect(decision.result).toBe("absent");
  });

  it("(ci-base) deadbeef / no-such-ref / unfetched sha refuse skip", async () => {
    const { decideBaseSelftestStep, SELFTEST_MARKER } = await import("./revert-proof-ci-gate.mjs");
    const commitExists = (ref: string) => {
      return spawnSync("git", ["cat-file", "-e", ref], { cwd: repoRoot, encoding: "utf8" }).status === 0;
    };
    for (const baseSha of ["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "no-such-ref"]) {
      const decision = decideBaseSelftestStep(() => false, baseSha, commitExists, () => "");
      expect(decision.action).toBe("fail");
      expect(decision.case).toBe("base_invalid_commit");
    }
    const missing = "0000000000000000000000000000000000000001";
    if (commitExists(`${missing}^{commit}`)) {
      return;
    }
    const unfetched = decideBaseSelftestStep(
      (p: string) => p === `${missing}:${SELFTEST_MARKER}`,
      missing,
      commitExists,
      () => "",
    );
    expect(unfetched.action).toBe("fail");
    expect(unfetched.case).toBe("base_invalid_commit");
  });

  it("(ci-head) when HEAD lacks the self-test marker, the step fails", async () => {
    const { assertHeadSelftestPresent } = await import("./revert-proof-ci-gate.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-ci-gate-head-"));
    try {
      const result = assertHeadSelftestPresent(root);
      expect(result.ok).toBe(false);
      expect(result.case).toBe("head_missing_marker");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("sidecar red value", () => {
  const meta = {
    runner: "vitest",
    testFile: "scripts/x.test.ts",
    testName: "x > y",
    description: "d",
    red: "AssertionError: expected 2 to be 1 // Object.is equality",
  };

  it("(5-red-required) sidecar without red string is rejected", () => {
    const { red: _, ...noRed } = meta;
    expect(thrownMessage(() => validateRowMeta(noRed, "r"))).toBe(
      'row r: sidecar JSON missing string field "red"',
    );
  });

  it("(5-red-shape) structured object sidecar is rejected", () => {
    expect(
      thrownMessage(() =>
        validateRowMeta({ ...meta, red: { actual: 2, expected: 1 } }, "r"),
      ),
    ).toBe("row r: red must be a single-line string, not an object (got structured sidecar)");
  });

  it("(5-red-shape) vitest red empty string is rejected", () => {
    expect(thrownMessage(() => validateRowMeta({ ...meta, red: "" }, "r"))).toBe(
      'row r: sidecar JSON missing string field "red"',
    );
  });

  it("(5-red-shape) pytest red must be assert source", () => {
    expect(
      thrownMessage(() =>
        validateRowMeta({ ...meta, runner: "pytest", red: "AssertionError: boom" }, "r"),
      ),
    ).toBe('row r: pytest red must start with "assert " (rewritten assert source)');
  });

  it("(5-red-mismatch) one-character red line mismatch is rejected", () => {
    expect(
      thrownMessage(() =>
        assertRedLine(
          "r",
          "AssertionError: expected 2 to be 1 // Object.is equality",
          {
            failureMessage: "AssertionError: expected 3 to be 1 // Object.is equality",
          },
          "vitest",
        ),
      ),
    ).toBe(
      'row r: red line mismatch (expected "AssertionError: expected 2 to be 1 // Object.is equality", got "AssertionError: expected 3 to be 1 // Object.is equality")',
    );
  });
});
