/** CI gate for revert-proof self-test (no pull_request_target; testable in vitest). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Marker file: skip base step only when this path is absent at base.sha. */
export const SELFTEST_MARKER = "scripts/revert-proof.test.ts";

export const SELFTEST_BUNDLE = [
  "scripts/revert-proof.test.ts",
  "scripts/revert-proof.lib.test.ts",
  "scripts/revert-proof.dogfood.test.ts",
  "scripts/vitest.config.mjs",
];

/** Main catch-up (#128): base lib.test referenced checkout proof trees; head uses temp fixtures. */
export const LEGACY_CHECKOUT_PROOF_LIB_TEST_SNIPPET =
  "revert-proofs/48/classify-rejects-plain-meta.patch";

export const SELFTEST_FIXTURE_PATCH = "scripts/fixtures/strict-git-apply-sample.patch";

/**
 * HEAD checkout must contain the marker (missing on head is always failure).
 * @param {string} repoRoot
 */
export function assertHeadSelftestPresent(repoRoot) {
  const abs = path.join(repoRoot, SELFTEST_MARKER);
  if (!fs.existsSync(abs)) {
    return {
      ok: false,
      case: "head_missing_marker",
      message: `revert-proof CI gate: FAIL — ${SELFTEST_MARKER} missing on HEAD checkout (always required)`,
      check: `test -f ${SELFTEST_MARKER}`,
    };
  }
  return {
    ok: true,
    case: "head_has_marker",
    message: `revert-proof CI gate: OK — ${SELFTEST_MARKER} present on HEAD checkout`,
    check: `test -f ${SELFTEST_MARKER}`,
  };
}

/**
 * Base step: SKIP only when marker absent at base.sha; if present, must run (skip refused).
 * @param {(gitPath: string) => boolean} catFileExists e.g. `sha:path` → git cat-file -e
 * @param {string} baseSha
 * @param {(commitRef: string) => boolean} [commitExists] e.g. `sha^{commit}` → git cat-file -e
 */
/**
 * @param {(gitPath: string) => string | null} [readTextAtRef] e.g. `sha:path` → git show stdout
 */
export function baseSelftestBundlePredatesHeadFixtures(catFileExists, baseSha, readTextAtRef) {
  const fixturePath = `${baseSha}:${SELFTEST_FIXTURE_PATCH}`;
  if (catFileExists(fixturePath)) {
    return false;
  }
  const libPath = `${baseSha}:scripts/revert-proof.lib.test.ts`;
  if (!catFileExists(libPath) || !readTextAtRef) {
    return false;
  }
  const libTest = readTextAtRef(libPath);
  return libTest.includes(LEGACY_CHECKOUT_PROOF_LIB_TEST_SNIPPET);
}

export function decideBaseSelftestStep(catFileExists, baseSha, commitExists, readTextAtRef) {
  const commitCheck = `git cat-file -e ${baseSha}^{commit}`;
  const commitResolvable = commitExists ? commitExists(`${baseSha}^{commit}`) : true;
  if (!commitResolvable) {
    return {
      action: "fail",
      case: "base_invalid_commit",
      message:
        `revert-proof CI gate: FAIL — base ${baseSha} is not a resolvable commit (${commitCheck})`,
      check: commitCheck,
      result: "absent",
    };
  }
  const gitPath = `${baseSha}:${SELFTEST_MARKER}`;
  const checkCmd = `git cat-file -e ${gitPath}`;
  if (!catFileExists(gitPath)) {
    return {
      action: "skip",
      case: "base_missing_marker",
      message:
        `revert-proof CI gate: SKIP allowed — ${SELFTEST_MARKER} absent at base ${baseSha} (first landing only)`,
      check: checkCmd,
      result: "absent",
    };
  }
  if (baseSelftestBundlePredatesHeadFixtures(catFileExists, baseSha, readTextAtRef)) {
    return {
      action: "skip",
      case: "base_stale_selftest_bundle",
      message:
        `revert-proof CI gate: SKIP allowed — base ${baseSha} self-test still references checkout catch-up proofs; head uses temp fixtures (#128)`,
      check: `git show ${baseSha}:scripts/revert-proof.lib.test.ts`,
      result: "stale",
    };
  }
  return {
    action: "run",
    case: "base_has_marker",
    message:
      `revert-proof CI gate: RUN required — ${SELFTEST_MARKER} present at base ${baseSha} (skip refused)`,
    check: checkCmd,
    result: "present",
  };
}

/**
 * After skip is refused, every bundle path must exist at base.sha (fail-closed).
 * @param {(gitPath: string) => boolean} catFileExists
 * @param {string} baseSha
 */
export function assertBaseBundleComplete(catFileExists, baseSha) {
  /** @type {string[]} */
  const missing = [];
  for (const rel of SELFTEST_BUNDLE) {
    const gitPath = `${baseSha}:${rel}`;
    if (!catFileExists(gitPath)) {
      missing.push(rel);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      message: `revert-proof CI gate: FAIL — bundle incomplete at base ${baseSha}: ${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

function gitCatFileExists(gitPath) {
  return spawnSync("git", ["cat-file", "-e", gitPath], { encoding: "utf8" }).status === 0;
}

function gitCommitExists(commitRef) {
  return gitCatFileExists(commitRef);
}

function gitShowText(gitPath) {
  const r = spawnSync("git", ["show", gitPath], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const root = repoRoot();

  if (cmd === "head-present") {
    const head = assertHeadSelftestPresent(root);
    console.log(head.message);
    console.log(`case=${head.case} check=${head.check}`);
    process.exit(head.ok ? 0 : 1);
  }

  if (cmd === "base-decision") {
    const baseSha = rest[0];
    if (!baseSha) {
      console.error("usage: revert-proof-ci-gate.mjs base-decision <base-sha>");
      process.exit(2);
    }
    const head = assertHeadSelftestPresent(root);
    if (!head.ok) {
      console.log(head.message);
      console.log(`case=${head.case} check=${head.check}`);
      process.exit(1);
    }
    const decision = decideBaseSelftestStep(
      gitCatFileExists,
      baseSha,
      gitCommitExists,
      gitShowText,
    );
    console.log(decision.message);
    console.log(
      `case=${decision.case} action=${decision.action} check=${decision.check} result=${decision.result}`,
    );
    if (decision.action === "fail") {
      process.exit(1);
    }
    if (decision.action === "skip") {
      process.exit(0);
    }
    const bundle = assertBaseBundleComplete(gitCatFileExists, baseSha);
    if (!bundle.ok) {
      console.log(bundle.message);
      process.exit(1);
    }
    process.exit(0);
  }

  console.error("unknown command");
  process.exit(2);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
