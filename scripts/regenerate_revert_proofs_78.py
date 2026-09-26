#!/usr/bin/env python3
"""Regenerate revert-proofs/78/*.patch (production-only) and JSON sidecars with measured red."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "revert-proofs" / "78"


@dataclass(frozen=True)
class Row:
    slug: str
    test_file: str
    test_name: str
    description: str
    paths: tuple[str, ...]
    apply_revert: callable


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text, encoding="utf-8")


def _replace(rel: str, old: str, new: str, *, count: int = 1) -> None:
    text = _read(rel)
    if old not in text:
        raise RuntimeError(f"{rel}: anchor not found for {Row}")
    _write(rel, text.replace(old, new, count))


def _git_diff(paths: tuple[str, ...]) -> str:
    r = subprocess.run(
        ["git", "diff", "--"] + list(paths),
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return r.stdout


def _checkout(paths: tuple[str, ...]) -> None:
    subprocess.run(["git", "checkout", "--"] + list(paths), cwd=ROOT, check=True)


def _pytest_node(test_file: str, test_name: str) -> str:
    return f"{test_file}::{test_name}"


def _run_pytest(node: str) -> tuple[int, str]:
    r = subprocess.run(
        [sys.executable, "-m", "pytest", node, "--no-cov", "-vv"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out


def _extract_assertion_red(output: str) -> str:
    """Return the AssertionError block from pytest output."""
    lines = output.splitlines()
    chunk: list[str] = []
    in_fail = False
    for line in lines:
        if "AssertionError" in line or line.strip().startswith("E   assert"):
            in_fail = True
        if in_fail:
            chunk.append(line)
        if in_fail and line.startswith("====") and len(chunk) > 3:
            break
    if not chunk:
        # fall back to short test summary + last E lines
        for line in lines:
            if line.startswith("E ") or "FAILED" in line:
                chunk.append(line)
    return "\n".join(chunk[-40:]).strip() or output[-2000:].strip()


def generate_row(row: Row) -> None:
    originals = {p: _read(p) for p in row.paths}
    try:
        row.apply_revert()
        patch = _git_diff(row.paths)
        if not patch.strip():
            raise RuntimeError(f"{row.slug}: empty diff")
        check_path = OUT / f"{row.slug}.patch.check"
        check_path.write_text(patch, encoding="utf-8")
        subprocess.run(["git", "apply", "--check", str(check_path)], cwd=ROOT, check=True)
        check_path.unlink(missing_ok=True)
        (OUT / f"{row.slug}.patch").write_text(patch, encoding="utf-8")
    finally:
        for p, text in originals.items():
            _write(p, text)

    node = _pytest_node(row.test_file, row.test_name)
    code, out = _run_pytest(node)
    if code == 0:
        raise RuntimeError(f"{row.slug}: test passed unpatched (expected pass)")
    # apply patch and fail
    patch_text = (OUT / f"{row.slug}.patch").read_text(encoding="utf-8")
    subprocess.run(["git", "apply", str(OUT / f"{row.slug}.patch")], cwd=ROOT, check=True)
    try:
        code2, out2 = _run_pytest(node)
        if code2 == 0:
            raise RuntimeError(f"{row.slug}: test stayed green after patch")
        red = _extract_assertion_red(out2)
        if "AssertionError" not in out2 and "assert" not in red:
            raise RuntimeError(f"{row.slug}: patched run did not fail on assertion: {out2[-500:]}")
    finally:
        subprocess.run(["git", "apply", "-R", str(OUT / f"{row.slug}.patch")], cwd=ROOT, check=True)

    meta = {
        "runner": "pytest",
        "testFile": row.test_file,
        "testName": row.test_name,
        "description": row.description,
        "patchedFailure": red,
    }
    (OUT / f"{row.slug}.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"OK {row.slug}")


def build_rows() -> list[Row]:
    rows: list[Row] = []

    def r01() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "        tree_sha = tree_hash_from_digests(tree_digests)\n",
            "        tree_sha, _reread = runtime_tree_hash_from_disk_with_byte_count(staging)\n",
        )

    rows.append(
        Row(
            "01-pa-tree-zero-staging-read",
            "tests/test_pack_safe_zip_install.py",
            "test_pa_fresh_install_zero_staging_hash_bytes",
            "Fresh install must not re-read staged files for tree hashing.",
            ("service/pack_safe_zip.py",),
            r01,
        )
    )

    def r02() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "    doc = _parse_plugin_yml(yml_bytes)\n"
            "    tree_sha = tree_hash_from_digests(tree_digests)\n"
            "    return _make_staged_pack(\n",
            "    doc = _parse_plugin_yml(yml_bytes)\n"
            "    tree_sha, _reread = runtime_tree_hash_from_disk_with_byte_count(root)\n"
            "    return _make_staged_pack(\n",
        )

    rows.append(
        Row(
            "02-pa-remint-reread-tree",
            "tests/test_pack_safe_zip_install.py",
            "test_pa_remint_hashes_only_plugin_yml",
            "Remint must hash only plugin.yml bytes, not the whole staged tree.",
            ("service/pack_safe_zip.py",),
            r02,
        )
    )

    def r03() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "    doc = _parse_plugin_yml(yml_bytes)\n"
            "    tree_sha = tree_hash_from_digests(tree_digests)\n"
            "    return _make_staged_pack(\n",
            "    doc = _parse_plugin_yml(yml_bytes)\n"
            "    tree_sha = legacy_runtime_tree_hash(root)\n"
            "    return _make_staged_pack(\n",
        )

    rows.append(
        Row(
            "03-pa-remint-tree-match",
            "tests/test_pack_safe_zip_install.py",
            "test_pa_remint_tree_matches_from_scratch",
            "Remint combined tree hash must match from-scratch v1 hash.",
            ("service/pack_safe_zip.py",),
            r03,
        )
    )

    def r04() -> None:
        old = "    for rel in sorted(member_sha256, key=_tree_path_sort_key):\n        digest.update(_tree_entry_bytes(rel, member_sha256[rel]))\n"
        new = (
            "    for rel in sorted(member_sha256, key=_tree_path_sort_key):\n"
            "        if rel != _REQUIRED:\n"
            "            continue\n"
            "        digest.update(_tree_entry_bytes(rel, member_sha256[rel]))\n"
        )
        _replace("service/pack_safe_zip.py", old, new)

    rows.append(
        Row(
            "04-pa-tree-path-sensitive",
            "tests/test_pack_safe_zip_install.py",
            "test_pa_tree_hash_sensitive_to_path_layout",
            "Tree hash must include every member path, not only plugin.yml.",
            ("service/pack_safe_zip.py",),
            r04,
        )
    )

    def r05() -> None:
        _replace(
            "service/plugin_install.py",
            "            except OSError as e:\n                if upgrade and runtime.is_dir():\n",
            "            except OSError:\n                if False and runtime.is_dir():\n",
        )

    rows.append(
        Row(
            "05-qe-upgrade-rollback",
            "tests/test_pack_safe_zip_install.py",
            "test_qe_upgrade_rollback_restores_v1_and_cleans_bak",
            "Upgrade rename failure must surface UX rollback copy and pack-info block.",
            ("service/plugin_install.py",),
            r05,
        )
    )

    def r06() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "        key = member_dedupe_key(rel)\n        if key in seen:\n",
            "        key = member_dedupe_key(rel)\n        if False and key in seen:\n",
        )

    rows.append(
        Row(
            "06-qe-duplicate-name",
            "tests/test_pack_safe_zip_install.py",
            "test_qe_duplicate_name_rejected_before_staging",
            "Duplicate normalized zip entry names rejected before staging.",
            ("service/pack_safe_zip.py",),
            r06,
        )
    )

    def r07() -> None:
        _replace(
            "service/plugin_install.py",
            "    recover_orphan_staging_dirs(local_rt)\n",
            "    # recover_orphan_staging_dirs(local_rt)\n",
        )

    rows.append(
        Row(
            "07-qe-crash-staging-boot",
            "tests/test_pack_safe_zip_install.py",
            "test_qe_crash_staging_removed_at_boot",
            "Crash-leftover .staging removed once at boot.",
            ("service/plugin_install.py",),
            r07,
        )
    )

    def r08() -> None:
        _replace(
            "service/pack_safe_zip.py",
            '    """Rename staging into ``runtime``; upgrade swaps via ``.bak``. Returns True when upgraded."""\n'
            "    _assert_staged_token(getattr(staged, \"_token\", None))\n"
            "    _consume_issued_staged(staged)\n",
            '    """Rename staging into ``runtime``; upgrade swaps via ``.bak``. Returns True when upgraded."""\n'
            "    _assert_staged_token(getattr(staged, \"_token\", None))\n"
            "    pass  # _consume_issued_staged(staged)\n",
        )

    rows.append(
        Row(
            "08-qe-staged-pack-registry",
            "tests/test_pack_safe_zip_install.py",
            "test_qe_staged_pack_guard_registry",
            "go-live consumes validator-issued StagedPack instances.",
            ("service/pack_safe_zip.py",),
            r08,
        )
    )

    def r09() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "            member_sha[rel] = hashlib.sha256(data).hexdigest()\n",
            "            member_sha[rel] = hashlib.sha256(data + b\"\\n\").hexdigest()\n",
            1,
        )

    rows.append(
        Row(
            "09-qe-staged-bytes-match",
            "tests/test_pack_safe_zip_install.py",
            "test_qe_staged_bytes_match_and_outside_staging_untouched",
            "On-disk staging bytes must match entry digests from validate.",
            ("service/pack_safe_zip.py",),
            r09,
        )
    )

    def r10() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "        if total > max_uncompressed:\n",
            "        if False and total > max_uncompressed:\n",
        )

    rows.append(
        Row(
            "10-qe-size-cap",
            "tests/test_pack_safe_zip_install.py",
            "test_qe_size_cap_uses_inflated_bytes_exact",
            "Inflated-byte cap uses actual inflated size.",
            ("service/pack_safe_zip.py",),
            r10,
        )
    )

    def r11() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "MANIFEST_MEMBER_MAX_BYTES = 65_536\n",
            "MANIFEST_MEMBER_MAX_BYTES = 1_000_000\n",
        )

    rows.append(
        Row(
            "11-pa-manifest-cap",
            "tests/test_pack_safe_zip_install.py",
            "test_pa_manifest_read_cap_65536_exact",
            "plugin.yml manifest read capped at 65536 bytes.",
            ("service/pack_safe_zip.py",),
            r11,
        )
    )

    def r12() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "        self._pack_stats.central_directory_parses += 1\n",
            "        pass  # self._pack_stats.central_directory_parses += 1\n",
        )

    rows.append(
        Row(
            "12-pedant-exact-counts",
            "tests/test_pack_safe_zip_install.py",
            "test_pedant_single_cd_parse_web_adopt_mcp",
            "Exactly one central-directory parse per install path.",
            ("service/pack_safe_zip.py",),
            r12,
        )
    )

    def r13() -> None:
        _replace(
            "service/pack_install_copy.py",
            '    return f"Couldn\'t install {stem}.zip. {tail}"\n',
            '    return f"Could not install {stem}.zip. {tail}"\n',
        )

    rows.append(
        Row(
            "13-ux-file-name-message",
            "tests/test_pack_zip_install_ux.py",
            "test_zip_ux_user_message_examples",
            "Zip unsafe user copy uses Couldn\'t install {stem}.zip.",
            ("service/pack_install_copy.py",),
            r13,
        )
    )

    def r14() -> None:
        _replace(
            "service/plugin_install.py",
            "def register_install_check(check: InstallCheck) -> None:\n    _INSTALL_CHECKS.append(check)\n",
            "def register_install_check(check: InstallCheck) -> None:\n    _INSTALL_CHECKS.insert(0, check)\n",
        )

    rows.append(
        Row(
            "14-validator-order",
            "tests/test_pack_safe_zip_install.py",
            "test_install_checks_run_in_registration_order",
            "Install validators run in ascending order value.",
            ("service/plugin_install.py",),
            r14,
        )
    )

    def r15() -> None:
        _replace(
            "service/pack_safe_zip.py",
            "        if actual != claimed:\n",
            "        if False and actual != claimed:\n",
        )

    rows.append(
        Row(
            "15-cd-declared-size",
            "tests/test_pack_safe_zip_install.py",
            "test_qe_cd_declared_size_larger_than_actual",
            "Reject zip entries whose declared size exceeds inflated bytes.",
            ("service/pack_safe_zip.py",),
            r15,
        )
    )

    def r16() -> None:
        _replace(
            "service/pack_install_copy.py",
            'ZIP_UX_CORRUPT_TAIL = "The file isn\'t a valid pack or is damaged."\n',
            'ZIP_UX_CORRUPT_TAIL = ""\n',
        )

    rows.append(
        Row(
            "16-literal-corrupt-tail",
            "tests/test_pack_zip_install_ux.py",
            "test_zip_ux_literal_corrupt_tail",
            "Literal corrupt zip tail copy.",
            ("service/pack_install_copy.py",),
            r16,
        )
    )

    def r17() -> None:
        _replace(
            "service/pack_install_copy.py",
            'ZIP_UX_CORRUPT_PRIOR_SUFFIX = ", so version {version} is still installed."\n',
            'ZIP_UX_CORRUPT_PRIOR_SUFFIX = ""\n',
        )

    rows.append(
        Row(
            "17-literal-prior-suffix",
            "tests/test_pack_zip_install_ux.py",
            "test_zip_ux_literal_corrupt_prior_suffix",
            "Literal prior-version suffix copy.",
            ("service/pack_install_copy.py",),
            r17,
        )
    )

    def r18() -> None:
        _replace(
            "service/pack_install_copy.py",
            'ZIP_UX_ENCRYPTED_TAIL = "It\'s password-protected. Zip it again without a password."\n',
            'ZIP_UX_ENCRYPTED_TAIL = ""\n',
        )

    rows.append(
        Row(
            "18-literal-encrypted-tail",
            "tests/test_pack_zip_install_ux.py",
            "test_zip_ux_literal_encrypted_tail",
            "Literal encrypted zip tail copy.",
            ("service/pack_install_copy.py",),
            r18,
        )
    )

    def r19() -> None:
        _replace(
            "service/pack_install_copy.py",
            'ZIP_UX_OVERSIZE_TAIL = "It unpacks to more than packs are allowed."\n',
            'ZIP_UX_OVERSIZE_TAIL = ""\n',
        )

    rows.append(
        Row(
            "19-literal-oversize-tail",
            "tests/test_pack_zip_install_ux.py",
            "test_zip_ux_literal_oversize_tail",
            "Literal oversize zip tail copy.",
            ("service/pack_install_copy.py",),
            r19,
        )
    )

    def r20() -> None:
        _replace(
            "service/pack_install_copy.py",
            "UPGRADE_ROLLBACK_UX_MESSAGE = (\n"
            "    \"Couldn't update {name} to version {new_version}, so version {old_version} is still installed. \"\n"
            "    \"Try again, and if it keeps failing, check the server log.\"\n"
            ")\n",
            'UPGRADE_ROLLBACK_UX_MESSAGE = ""\n',
        )

    rows.append(
        Row(
            "20-literal-upgrade-rollback",
            "tests/test_pack_zip_install_ux.py",
            "test_zip_ux_literal_upgrade_rollback_message",
            "Literal upgrade rollback message template.",
            ("service/pack_install_copy.py",),
            r20,
        )
    )

    def r21() -> None:
        _replace(
            "service/plugins.py",
            "        if rec.get(\"tree_hash_version\") == PACK_TREE_HASH_VERSION:\n            continue\n",
            "        if False and rec.get(\"tree_hash_version\") == PACK_TREE_HASH_VERSION:\n            continue\n",
        )

    rows.append(
        Row(
            "21-consent-migration-rehash",
            "tests/test_pack_safe_zip_install.py",
            "test_consent_survives_pack_tree_hash_migration",
            "Consent tree hash migrated once per record (boot2 reads 0 bytes).",
            ("service/plugins.py",),
            r21,
        )
    )

    return rows


def main() -> None:
    # Remove obsolete duplicate-number patches
    for stale in OUT.glob("*.patch"):
        if stale.stem in {
            "06-qe-crash-staging-boot",
            "07-qe-staged-bytes",
            "07-qe-staged-pack-registry",
            "08-qe-size-cap",
            "09-pa-manifest-cap",
            "10-pedant-exact-counts",
            "11-ux-file-name-message",
            "12-validator-order",
            "13-cd-declared-size",
            "14-literal-corrupt-tail",
            "15-literal-prior-suffix",
            "16-literal-encrypted-tail",
            "17-literal-oversize-tail",
            "18-literal-upgrade-rollback",
            "19-consent-migration-rehash",
        }:
            stale.unlink()
            json_path = stale.with_suffix(".json")
            if json_path.is_file():
                json_path.unlink()

    only = sys.argv[1:] if len(sys.argv) > 1 else None
    for row in build_rows():
        if only and row.slug not in only:
            continue
        generate_row(row)


if __name__ == "__main__":
    main()
