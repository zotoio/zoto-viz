#!/usr/bin/env python3
import json
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sh(cmd: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)


def vitest_path(test_file: str) -> str:
    tf = test_file.replace("web/src/", "src/")
    if not tf.startswith("src/"):
        tf = f"src/{tf.lstrip('/')}"
    return tf


def run_rows(branch: str, splits: list[str]) -> list[tuple]:
    sh(f"git checkout -q {branch}")
    out: list[tuple] = []
    for split in splits:
        for j in sorted(glob.glob(f"revert-proofs/{split}/*.json")):
            slug = os.path.basename(j).replace(".json", "")
            d = json.load(open(j))
            patch = j.replace(".json", ".patch")
            chk = sh(f"git apply --check {patch}")
            if chk.returncode:
                out.append((slug, "apply-check-fail", chk.stderr.strip().split("\n")[0]))
                continue
            ap = sh(f"git apply {patch}")
            if ap.returncode:
                out.append((slug, "apply-fail", ap.stderr.strip().split("\n")[0]))
                sh("git checkout -- .")
                continue
            vpath = vitest_path(d.get("testFile", ""))
            r = sh(f"cd web && pnpm exec vitest run {vpath} 2>&1")
            sh("git checkout -- .")
            text = r.stdout + r.stderr
            m = re.search(r"AssertionError:.*", text)
            red = m.group(0).split("\n")[0] if m else "NO_ASSERTION"
            fm = re.search(r"Tests\s+(\d+) failed", text)
            fc = int(fm.group(1)) if fm else -1
            out.append((slug, red, f"failed={fc}"))
    return out


def main() -> None:
    branches = [
        ("52a", "origin/cursor/dogfood-soak-52a-c58c", ["52a"]),
        ("52b", "origin/cursor/dogfood-soak-52b-c58c", ["52a", "52b"]),
        ("52c", "origin/cursor/dogfood-soak-52c-c58c", ["52a", "52b", "52c"]),
    ]
    for label, br, spl in branches:
        print(f"=== {label} {br} ===")
        for row in run_rows(br, spl):
            print("\t".join(str(x) for x in row))


if __name__ == "__main__":
    main()
