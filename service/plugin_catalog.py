"""Remote plugin catalog: fetch manifest from a private GitHub repo, verify sha256, install locally.

Auth preference: ``gh`` CLI session → SSH deploy key → ``GITHUB_TOKEN`` /
``ZOTO_VIZ_PLUGIN_CATALOG_TOKEN`` env. Remote zips land in ``~/.zoto-viz/plugins/local/<id>.zip``
with ``origin: local`` and still require consent before code runs.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import paths
from . import plugin_local
from . import plugins
from . import sysconfig

log = logging.getLogger(__name__)

SKIP_ENV = "ZOTO_VIZ_NO_PLUGIN_CATALOG"
REPO_ENV = "ZOTO_VIZ_PLUGIN_CATALOG_REPO"
INTERVAL_ENV = "ZOTO_VIZ_PLUGIN_CATALOG_INTERVAL"
AUTH_ENV = "ZOTO_VIZ_PLUGIN_CATALOG_AUTH"
TOKEN_ENV = "ZOTO_VIZ_PLUGIN_CATALOG_TOKEN"
DEFAULT_INTERVAL_S = 3600.0
DEFAULT_MANIFEST = "manifest.json"
STATE_FILE = "plugin-catalog-state.json"

Run = Callable[[list[str], Path | None, dict[str, str] | None], tuple[int, str, str]]


@dataclass(frozen=True)
class CatalogConfig:
    repo: str
    ref: str
    tag: str
    release: str
    manifest_path: str
    interval_s: float
    auth: str  # gh | ssh | token | off
    deploy_key: str

    @property
    def enabled(self) -> bool:
        return bool(self.repo.strip()) and self.auth != "off"


def _run_capture(
    cmd: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> tuple[int, str, str]:
    merged = {**os.environ, **(env or {})}
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
            env=merged,
        )
    except FileNotFoundError:
        return 127, "", f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def _bool_env(key: str) -> bool:
    return os.environ.get(key, "").strip().lower() in {"1", "true", "yes", "on"}


def _repo_slug(raw: str) -> str:
    text = (raw or "").strip()
    text = re.sub(r"^https://github\.com/", "", text, flags=re.I)
    text = text.strip("/")
    if text.endswith(".git"):
        text = text[:-4]
    return text


def load_config(cfg: dict[str, Any] | None = None) -> CatalogConfig:
    raw = cfg if cfg is not None else sysconfig.load()
    block = raw.get("plugin_catalog") if isinstance(raw.get("plugin_catalog"), dict) else {}
    repo = os.environ.get(REPO_ENV, "").strip() or str(block.get("repo") or "").strip()
    ref = str(block.get("ref") or "main").strip() or "main"
    tag = str(block.get("tag") or "").strip()
    release = str(block.get("release") or "").strip()
    manifest_path = str(block.get("manifest_path") or DEFAULT_MANIFEST).strip() or DEFAULT_MANIFEST
    auth = os.environ.get(AUTH_ENV, "").strip().lower() or str(block.get("auth") or "gh").strip().lower()
    if auth not in {"gh", "ssh", "token", "off"}:
        auth = "gh"
    deploy_key = str(
        block.get("deploy_key")
        or os.environ.get("ZOTO_VIZ_PLUGIN_CATALOG_DEPLOY_KEY")
        or "~/.zoto-viz/plugin-catalog_deploy_key"
    ).strip()
    interval_raw = os.environ.get(INTERVAL_ENV, "").strip() or block.get("interval")
    try:
        interval_s = float(interval_raw) if interval_raw is not None else DEFAULT_INTERVAL_S
    except (TypeError, ValueError):
        interval_s = DEFAULT_INTERVAL_S
    return CatalogConfig(
        repo=_repo_slug(repo),
        ref=ref,
        tag=tag,
        release=release,
        manifest_path=manifest_path.lstrip("/"),
        interval_s=max(0.0, interval_s),
        auth=auth,
        deploy_key=deploy_key,
    )


def disabled(cfg: CatalogConfig | None = None) -> bool:
    if _bool_env(SKIP_ENV):
        return True
    cfg = cfg or load_config()
    return not cfg.enabled


def interval_s(cfg: CatalogConfig | None = None) -> float:
    cfg = cfg or load_config()
    return cfg.interval_s


def state_path() -> Path:
    d = paths.user_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / STATE_FILE


def load_state() -> dict[str, Any]:
    path = state_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"installed": {}}
    if not isinstance(raw, dict):
        return {"installed": {}}
    installed = raw.get("installed")
    if not isinstance(installed, dict):
        raw["installed"] = {}
    return raw


def save_state(state: dict[str, Any]) -> None:
    path = state_path()
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def local_version(pid: str) -> int | None:
    for row in plugins.scan().get("plugins") or []:
        if row.get("id") == pid and row.get("origin") in {"local", "zip", "src"}:
            try:
                return int(row.get("version") or 0)
            except (TypeError, ValueError):
                return None
    dest = paths.plugin_local_dir() / f"{pid}.zip"
    if dest.is_file():
        return None
    return None


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _parse_manifest(raw: bytes) -> dict[str, Any]:
    doc = json.loads(raw.decode("utf-8"))
    if not isinstance(doc, dict):
        raise ValueError("manifest must be a JSON object")
    entries = doc.get("plugins")
    if not isinstance(entries, list):
        raise ValueError("manifest.plugins must be an array")
    return doc


class CatalogFetcher:
    """Fetch catalog files using gh, ssh, or token auth."""

    def __init__(self, cfg: CatalogConfig, run: Run | None = None) -> None:
        self.cfg = cfg
        self._run = run or _run_capture

    def gh_available(self) -> bool:
        return shutil.which("gh") is not None

    def gh_authenticated(self) -> bool:
        if not self.gh_available():
            return False
        code, _out, _err = self._run(["gh", "auth", "status"], None, None)
        return code == 0

    def fetch_manifest(self) -> bytes:
        if self.cfg.auth == "off":
            raise RuntimeError("plugin catalog auth is off")
        if self.cfg.auth == "gh":
            return self._fetch_manifest_gh()
        if self.cfg.auth == "ssh":
            return self._fetch_manifest_ssh()
        if self.cfg.auth == "token":
            return self._fetch_manifest_token()
        raise RuntimeError(f"unknown plugin catalog auth: {self.cfg.auth}")

    def download_plugin(self, url: str) -> bytes:
        if self.cfg.auth == "gh":
            return self._download_gh(url)
        if self.cfg.auth == "ssh":
            return self._download_ssh(url)
        if self.cfg.auth == "token":
            return self._download_token(url)
        raise RuntimeError(f"unknown plugin catalog auth: {self.cfg.auth}")

    def _repo_api_base(self) -> str:
        return f"repos/{self.cfg.repo}"

    def _fetch_manifest_gh(self) -> bytes:
        if not self.gh_available():
            raise RuntimeError("gh not on PATH — install GitHub CLI and run: gh auth login")
        if not self.gh_authenticated():
            raise RuntimeError("gh auth status failed — run: gh auth login")
        if self.cfg.release or self.cfg.tag:
            tag = self.cfg.tag or self.cfg.release
            with tempfile.TemporaryDirectory(prefix="zoto-catalog-manifest.") as tmp:
                code, _out, err = self._run(
                    [
                        "gh",
                        "release",
                        "download",
                        tag,
                        "-R",
                        self.cfg.repo,
                        "-p",
                        self.cfg.manifest_path,
                        "-D",
                        tmp,
                    ],
                    None,
                    None,
                )
                if code != 0:
                    raise RuntimeError(self._safe_err(err or f"gh release download exit {code}"))
                matches = list(Path(tmp).glob(self.cfg.manifest_path))
                if not matches:
                    matches = list(Path(tmp).glob("*"))
                if not matches:
                    raise RuntimeError(f"manifest asset {self.cfg.manifest_path!r} not found in release")
                return matches[0].read_bytes()
        path = f"{self._repo_api_base()}/contents/{self.cfg.manifest_path}"
        if self.cfg.ref:
            path += f"?ref={self.cfg.ref}"
        code, out, err = self._run(["gh", "api", path, "--jq", ".content"], None, None)
        if code != 0:
            raise RuntimeError(self._safe_err(err or out or f"gh api exit {code}"))
        blob = (out or "").strip()
        if not blob:
            raise RuntimeError("manifest content empty")
        return base64.b64decode(blob)

    def _download_gh(self, url: str) -> bytes:
        if not self.gh_available():
            raise RuntimeError("gh not on PATH")
        if not self.gh_authenticated():
            raise RuntimeError("gh auth status failed — run: gh auth login")
        name = Path(url).name
        if self.cfg.release or self.cfg.tag or (not url.startswith("http") and "/" not in url):
            tag = self.cfg.tag or self.cfg.release or "latest"
            with tempfile.TemporaryDirectory(prefix="zoto-catalog.") as tmp:
                code, _out, err = self._run(
                    [
                        "gh",
                        "release",
                        "download",
                        tag,
                        "-R",
                        self.cfg.repo,
                        "-p",
                        name,
                        "-D",
                        tmp,
                    ],
                    None,
                    None,
                )
                if code != 0:
                    raise RuntimeError(self._safe_err(err or f"gh release download exit {code}"))
                matches = list(Path(tmp).glob(name))
                if not matches:
                    raise RuntimeError(f"release asset {name!r} not found")
                return matches[0].read_bytes()
        if url.startswith("http://") or url.startswith("https://"):
            code, out, err = self._run(["gh", "api", url, "--header", "Accept: application/octet-stream"], None, None)
            if code != 0:
                raise RuntimeError(self._safe_err(err or out or f"gh api download exit {code}"))
            return out.encode("latin-1") if isinstance(out, str) else out
        path = f"{self._repo_api_base()}/contents/{url.lstrip('/')}"
        if self.cfg.ref:
            path += f"?ref={self.cfg.ref}"
        code, out, err = self._run(["gh", "api", path, "--jq", ".content"], None, None)
        if code != 0:
            raise RuntimeError(self._safe_err(err or out or f"gh api exit {code}"))
        return base64.b64decode((out or "").strip())

    def _ssh_env(self) -> dict[str, str]:
        key = str(Path(self.cfg.deploy_key).expanduser())
        return {"GIT_SSH_COMMAND": f'ssh -i "{key}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'}

    def _fetch_manifest_ssh(self) -> bytes:
        return self._git_show_file(self.cfg.manifest_path)

    def _download_ssh(self, url: str) -> bytes:
        if url.startswith("http://") or url.startswith("https://"):
            raise RuntimeError("ssh auth cannot fetch absolute http URLs")
        return self._git_show_file(url.lstrip("/"))

    def _git_show_file(self, relpath: str) -> bytes:
        ref = self.cfg.tag or self.cfg.ref or "HEAD"
        repo_url = f"git@github.com:{self.cfg.repo}.git"
        code, out, err = self._run(
            ["git", "archive", "--remote", repo_url, ref, relpath],
            None,
            self._ssh_env(),
        )
        if code != 0:
            # git archive --remote is often disabled; fall back to sparse clone in temp
            return self._sparse_fetch(relpath)
        # git archive writes tar to stdout; for single file we need extract — use sparse instead
        return self._sparse_fetch(relpath)

    def _sparse_fetch(self, relpath: str) -> bytes:
        ref = self.cfg.tag or self.cfg.ref or "main"
        repo_url = f"git@github.com:{self.cfg.repo}.git"
        with tempfile.TemporaryDirectory(prefix="zoto-catalog-clone.") as tmp:
            env = self._ssh_env()
            init = self._run(
                ["git", "clone", "--depth", "1", "--branch", ref, "--filter=blob:none", "--sparse", repo_url, tmp],
                None,
                env,
            )
            if init[0] != 0:
                raise RuntimeError(self._safe_err(init[2] or init[1] or "git clone failed"))
            sparse = self._run(["git", "sparse-checkout", "set", relpath], Path(tmp), env)
            if sparse[0] != 0:
                raise RuntimeError(self._safe_err(sparse[2] or sparse[1] or "sparse-checkout failed"))
            pull = self._run(["git", "checkout"], Path(tmp), env)
            if pull[0] != 0:
                raise RuntimeError(self._safe_err(pull[2] or pull[1] or "git checkout failed"))
            target = Path(tmp) / relpath
            if not target.is_file():
                raise RuntimeError(f"file {relpath!r} not found in {self.cfg.repo}@{ref}")
            return target.read_bytes()

    def _token(self) -> str:
        tok = os.environ.get(TOKEN_ENV, "").strip() or os.environ.get("GITHUB_TOKEN", "").strip()
        if not tok:
            raise RuntimeError(
                f"set {TOKEN_ENV} or GITHUB_TOKEN for token auth (never commit tokens to sys-config)"
            )
        return tok

    def _fetch_manifest_token(self) -> bytes:
        return self._github_api_get(f"/repos/{self.cfg.repo}/contents/{self.cfg.manifest_path}")

    def _download_token(self, url: str) -> bytes:
        if url.startswith("http://") or url.startswith("https://"):
            return self._github_http_get(url)
        return self._github_api_get(f"/repos/{self.cfg.repo}/contents/{url.lstrip('/')}")

    def _github_api_get(self, api_path: str) -> bytes:
        import urllib.error
        import urllib.request

        tok = self._token()
        ref_q = f"?ref={self.cfg.ref}" if self.cfg.ref and "?" not in api_path else ""
        req = urllib.request.Request(
            f"https://api.github.com{api_path}{ref_q}",
            headers={
                "Authorization": f"Bearer {tok}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "zoto-viz-plugin-catalog",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise RuntimeError("GitHub token rejected (401) — rotate token and retry") from exc
            raise RuntimeError(f"GitHub API {exc.code}: {exc.reason}") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("unexpected GitHub API response")
        content = payload.get("content")
        if not isinstance(content, str):
            raise RuntimeError("GitHub contents API did not return base64 content")
        return base64.b64decode(content)

    def _github_http_get(self, url: str) -> bytes:
        import urllib.error
        import urllib.request

        tok = self._token()
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {tok}",
                "Accept": "application/octet-stream",
                "User-Agent": "zoto-viz-plugin-catalog",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise RuntimeError("GitHub token rejected (401) — rotate token and retry") from exc
            raise RuntimeError(f"GitHub download {exc.code}: {exc.reason}") from exc

    @staticmethod
    def _safe_err(text: str) -> str:
        """Strip token-like substrings from error messages."""
        return re.sub(r"(gho_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)", "[token]", text or "").strip()


def poll_once(cfg: CatalogConfig | None = None, *, fetcher: CatalogFetcher | None = None) -> dict[str, Any]:
    """One catalog pass: fetch manifest, install newer plugins, skip failures."""
    cfg = cfg or load_config()
    out: dict[str, Any] = {"action": "noop", "repo": cfg.repo}
    if disabled(cfg):
        out["action"] = "skipped"
        out["reason"] = SKIP_ENV if _bool_env(SKIP_ENV) else "catalog disabled (no repo or auth=off)"
        return out
    fetcher = fetcher or CatalogFetcher(cfg)
    try:
        manifest_raw = fetcher.fetch_manifest()
    except Exception as exc:  # noqa: BLE001
        out["action"] = "error"
        out["error"] = str(exc)
        log.warning("plugin catalog manifest fetch failed: %s", exc)
        return out
    try:
        manifest = _parse_manifest(manifest_raw)
    except Exception as exc:  # noqa: BLE001
        out["action"] = "error"
        out["error"] = f"invalid manifest: {exc}"
        return out
    state = load_state()
    installed_map: dict[str, Any] = dict(state.get("installed") or {})
    results: list[dict[str, Any]] = []
    for entry in manifest.get("plugins") or []:
        if not isinstance(entry, dict):
            continue
        pid = str(entry.get("id") or "").strip()
        if not pid:
            continue
        try:
            want_ver = int(entry.get("version") or 0)
        except (TypeError, ValueError):
            results.append({"id": pid, "action": "skip", "reason": "invalid version"})
            continue
        have_ver = local_version(pid)
        prev = installed_map.get(pid) or {}
        if have_ver is not None and have_ver >= want_ver:
            results.append({"id": pid, "action": "skip", "reason": f"local v{have_ver} >= v{want_ver}"})
            continue
        if int(prev.get("version") or 0) >= want_ver and prev.get("sha256") == entry.get("sha256"):
            results.append({"id": pid, "action": "skip", "reason": "already installed this version"})
            continue
        url = str(entry.get("url") or "").strip()
        expect_sha = str(entry.get("sha256") or "").strip().lower()
        if not url or not re.fullmatch(r"[a-f0-9]{64}", expect_sha or ""):
            results.append({"id": pid, "action": "skip", "reason": "missing url or sha256"})
            continue
        try:
            blob = fetcher.download_plugin(url)
        except Exception as exc:  # noqa: BLE001
            results.append({"id": pid, "action": "error", "error": str(exc)})
            log.warning("plugin catalog download %s failed: %s", pid, exc)
            continue
        got_sha = _sha256_bytes(blob)
        if got_sha != expect_sha:
            results.append({
                "id": pid,
                "action": "error",
                "error": f"sha256 mismatch (got {got_sha[:12]}…, want {expect_sha[:12]}…)",
            })
            log.warning("plugin catalog sha256 mismatch for %s", pid)
            continue
        try:
            info = plugin_local.install_local_zip(blob, overwrite=True, activate=False)
        except Exception as exc:  # noqa: BLE001
            results.append({"id": pid, "action": "error", "error": str(exc)})
            log.warning("plugin catalog install %s failed: %s", pid, exc)
            continue
        if not info.get("ok"):
            results.append({
                "id": pid,
                "action": "error",
                "error": info.get("message") or info.get("error") or "install failed",
            })
            continue
        installed_map[pid] = {
            "version": want_ver,
            "sha256": expect_sha,
            "installed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        results.append({
            "id": pid,
            "action": "installed",
            "version": want_ver,
            "consentRequired": bool(info.get("consentRequired")),
            "path": info.get("path"),
        })
        plugin_local.notify_catalog()
    state["installed"] = installed_map
    state["last_poll"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save_state(state)
    out["action"] = "polled"
    out["results"] = results
    return out


async def poll_loop() -> None:
    """Background task: poll on startup then every ``interval_s``."""
    import asyncio

    cfg = load_config()
    if disabled(cfg):
        return
    delay = min(30.0, interval_s(cfg) or 30.0)
    await asyncio.sleep(delay)
    while True:
        try:
            info = await asyncio.to_thread(poll_once, cfg)
            if info.get("action") == "error":
                log.warning("plugin catalog: %s", info.get("error"))
        except Exception as exc:  # noqa: BLE001
            log.warning("plugin catalog poll failed: %s", exc)
        wait = interval_s(cfg)
        if wait <= 0:
            return
        await asyncio.sleep(wait)
