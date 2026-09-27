#!/usr/bin/env python3
"""Replay revert rows at a branch head; report pass→fail and first AssertionError."""
import json
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sh(cmd: str, cwd: str = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)


def vitest_path(test_file: str) -> str:
    tf = test_file.replace("web/src/", "src/")
    if not tf.startswith("src/"):
        tf = f"src/{tf.lstrip('/')}"
    return tf


def replay(branch: str, proof_dir: str) -> list[dict]:
    sh(f"git checkout -q {branch}")
    sh("git checkout -- .", cwd=ROOT)
    rows: list[dict] = []
    pattern = f"{proof_dir}/*.json"
    for j in sorted(glob.glob(pattern)):
        slug = os.path.basename(j).replace(".json", "")
        d = json.load(open(j))
        patch = j.replace(".json", ".patch")
        entry = {"slug": slug, "branch": branch, "proof": proof_dir}
        chk = sh(f"git apply --check {patch}")
        if chk.returncode:
            entry["status"] = "apply-check-fail"
            entry["detail"] = (chk.stderr or chk.stdout).strip().split("\n")[0]
            rows.append(entry)
            continue
        # unpatched: run test file once per slug (skip if same file already green)
        tf = d.get("testFile", "")
        vpath = vitest_path(tf) if tf else ""
        tn = d.get("testName", "")
        vitest_cmd = f"cd web && pnpm exec vitest run {vpath}"
        if tn:
            # escape for shell
            safe = tn.replace("'", "'\\''")
            vitest_cmd += f" -t '{safe}'"
        r0 = sh(vitest_cmd + " 2>&1")
        text0 = r0.stdout + r0.stderr
        if "FAIL" in text0 or re.search(r"\d+ failed", text0):
            entry["status"] = "unpatched-not-green"
            m0 = re.search(r"AssertionError:.*", text0) or re.search(r"TypeError:.*", text0)
            entry["detail"] = m0.group(0).split("\n")[0] if m0 else text0.split("\n")[-3:]
            rows.append(entry)
            sh("git checkout -- .", cwd=ROOT)
            continue
        ap = sh(f"git apply {patch}")
        if ap.returncode:
            entry["status"] = "apply-fail"
            entry["detail"] = (ap.stderr or ap.stdout).strip().split("\n")[0]
            rows.append(entry)
            sh("git checkout -- .", cwd=ROOT)
            continue
        r1 = sh(vitest_cmd + " 2>&1")
        sh("git checkout -- .", cwd=ROOT)
        text1 = r1.stdout + r1.stderr
        fail_m = re.search(r"Tests\s+(\d+) failed", text1)
        failed = int(fail_m.group(1)) if fail_m else 0
        if failed < 1:
            entry["status"] = "patched-still-passes"
            entry["detail"] = f"failed={failed}"
            rows.append(entry)
            continue
        am = re.search(r"AssertionError:.*", text1)
        tm = re.search(r"TypeError:.*", text1)
        if am:
            entry["status"] = "OK"
            entry["red"] = am.group(0).split("\n")[0]
            entry["failed"] = failed
        elif tm:
            entry["status"] = "TYPEERROR"
            entry["red"] = tm.group(0).split("\n")[0]
            entry["failed"] = failed
        else:
            entry["status"] = "no-assertion"
            entry["detail"] = text1.split("\n")[-8:]
            entry["failed"] = failed
        rows.append(entry)
    return rows


def main() -> None:
    suites = [
        ("origin/cursor/dogfood-soak-52a-c58c", "revert-proofs/96"),
        ("origin/cursor/dogfood-soak-52b-c58c", "revert-proofs/107"),
        ("origin/cursor/dogfood-soak-52c-c58c", "revert-proofs/108"),
    ]
    for branch, proof in suites:
        head = sh(f"git rev-parse {branch}").stdout.strip()
        print(f"=== {proof} @ {branch} ({head}) ===")
        for row in replay(branch, proof):
            if row.get("status") == "OK":
                print(f"{row['slug']}\t{row['red']}")
            else:
                print(f"{row['slug']}\t{row['status']}\t{row.get('red') or row.get('detail')}")


if __name__ == "__main__":
    main()
