"""Serve ``sky/fragment.glsl`` behind consent; stamp includes ``shader_sha256``."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import yaml

from service import plugin_sky as psky
from service import plugin_zip as pz
from service import plugins
from service.plugin_zip import plugin_sha256


OK_FRAG = """\
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = mix(uBg, uAccent, 0.5 + 0.5 * dir.y);
  fragColor = vec4(col * uBright, uOpacity);
}
"""

BAD_FRAG = """\
uniform float uMode;
void main() { fragColor = vec4(uAccent, uOpacity); }
"""


def _req(pid: str, query: dict[str, str] | None = None):
    return SimpleNamespace(match_info={"id": pid}, rel_url=SimpleNamespace(query=query or {}))


def _sky_tree(home: Path, *, pid: str = "aurora-sky", frag: str = OK_FRAG) -> Path:
    home.mkdir(parents=True)
    (home / "plugin.yml").write_text(
        f"id: {pid}\nname: Aurora\nversion: 1\nengine: graph\nbase: topology\n",
        encoding="utf-8",
    )
    (home / "sky").mkdir()
    (home / "sky" / "fragment.glsl").write_text(frag, encoding="utf-8")
    return home


def _write_sky_src(repo: Path, *, pid: str = "aurora-sky", frag: str = OK_FRAG) -> Path:
    return _sky_tree(repo / "plugins" / "src" / pid, pid=pid, frag=frag)


def _pack_sky_zip_only(repo: Path, *, pid: str = "aurora-sky", frag: str = OK_FRAG) -> Path:
    pack = repo.parent / "pack" / pid
    _sky_tree(pack, pid=pid, frag=frag)
    dest = repo / "plugins" / f"{pid}.zip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    pz.pack_tree(pack, dest)
    return dest


def test_validate_source_whitelist() -> None:
    assert psky.validate_source(OK_FRAG) is None
    err = psky.validate_source(BAD_FRAG)
    assert err and "uMode" in err
    assert psky.validate_source("#include \"lib.glsl\"\nvoid main() {}")
    assert psky.validate_source("vec3 color() { return uAccent; }")


def test_sky_endpoint_requires_consent_and_bumps_hash(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "repo"
    src = _write_sky_src(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.reset_bundles()

    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    row = result["plugins"][0]
    assert row["origin"] == "src"
    assert row["has_sky"] is True
    assert row["has_sky_shader"] is True
    assert row["shader_sha256"]
    assert row["sky_available"] is False
    assert row["sky_error"] == "awaiting review"
    assert plugins.needs_review(row) is True
    assert plugins.consented(row) is False
    assert plugins.consented_for(row, {"shader": row["shader_sha256"]}) is False
    assert not (repo / "plugins" / ".runtime" / "aurora-sky").exists()

    denied = plugins.api_sky(_req("aurora-sky"))
    assert denied.status == 403
    body = denied.body.decode("utf-8") if isinstance(denied.body, (bytes, bytearray)) else str(denied.text)
    assert "awaiting review" in body

    plugins.grant_consent(row, "reviewed")
    rec = yaml.safe_load((tmp_path / "plugin-consent.yml").read_text(encoding="utf-8"))
    assert rec["aurora-sky"]["shader_sha256"] == row["shader_sha256"]
    assert plugins.consent_hashes(row)["shader"] == row["shader_sha256"]
    assert plugins.consented_for(row, {"shader": row["shader_sha256"]}) is True
    assert set(plugins.CONSENT_ARTEFACTS) == {"frontend", "backend", "collector", "shader", "assets"}

    fresh = plugins.scan(repo)["plugins"][0]
    assert fresh["sky_available"] is True
    assert "sky_error" not in fresh or not fresh.get("sky_error")

    ok = plugins.api_sky(_req("aurora-sky"))
    assert ok.status == 200
    assert ok.content_type == "text/x-shader"
    assert "mix(uBg, uAccent" in ok.text
    assert ok.headers["Cache-Control"] == "private, max-age=30"
    assert ok.headers["X-Zoto-Viz-Hash"] == fresh["sha256"]

    hashed = plugins.api_sky(_req("aurora-sky", {"h": fresh["sha256"]}))
    assert hashed.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    glsl = src / "sky" / "fragment.glsl"
    glsl.write_text(OK_FRAG + "\n// edited\n", encoding="utf-8")
    edited = plugins.scan(repo)["plugins"][0]
    assert edited["shader_sha256"] != row["shader_sha256"]
    assert plugins.consented(edited) is False
    assert plugins.consented_for(edited, {"shader": edited["shader_sha256"]}) is False
    stale = plugins.api_sky(_req("aurora-sky"))
    assert stale.status == 403
    stamp = yaml.safe_load((tmp_path / "plugin-consent.yml").read_text(encoding="utf-8"))
    assert stamp["aurora-sky"]["shader_sha256"] == row["shader_sha256"]


def test_sky_zip_only_unpacks_and_bumps_runtime_hash(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "repo"
    _pack_sky_zip_only(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.reset_bundles()

    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    row = result["plugins"][0]
    assert row["origin"] == "zip"
    assert row["has_sky_shader"] is True
    assert not (repo / "plugins" / "src").exists()
    glsl = repo / "plugins" / ".runtime" / "aurora-sky" / "sky" / "fragment.glsl"
    assert glsl.is_file()
    plugins.grant_consent(row, "reviewed")
    fresh = plugins.scan(repo)["plugins"][0]
    assert fresh["sky_available"] is True
    glsl.write_text(OK_FRAG + "\n// edited\n", encoding="utf-8")
    edited = plugins.scan(repo)["plugins"][0]
    assert edited["shader_sha256"] != row["shader_sha256"]
    assert plugins.consented(edited) is False
    stale = plugins.api_sky(_req("aurora-sky"))
    assert stale.status == 403


def test_sky_compile_error_marks_catalog_unavailable(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "repo"
    _write_sky_src(repo, pid="bad-sky", frag=BAD_FRAG)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    row = plugins.scan(repo)["plugins"][0]
    assert row["origin"] == "src"
    plugins.grant_consent(row, "authored")
    fresh = plugins.scan(repo)["plugins"][0]
    assert fresh["sky_available"] is False
    assert "compile error" in fresh["sky_error"]
    assert "uMode" in fresh["sky_error"]
    denied = plugins.api_sky(_req("bad-sky"))
    assert denied.status == 404


def test_missing_sky_is_404(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "repo"
    src = repo / "plugins" / "src" / "topology"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(
        "id: topology\nname: Topology\nversion: 1\nengine: graph\nbase: topology\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()
    missing = plugins.api_sky(_req("topology"))
    assert missing.status == 404
    unknown = plugins.api_sky(_req("nope"))
    assert unknown.status == 404


def test_artefacts_hash_shader(tmp_path: Path) -> None:
    home = tmp_path / "glow"
    (home / "sky").mkdir(parents=True)
    yml = home / "plugin.yml"
    yml.write_text("id: glow\nname: Glow\nversion: 1\nengine: graph\nbase: topology\n", encoding="utf-8")
    glsl = home / "sky" / "fragment.glsl"
    glsl.write_text(OK_FRAG, encoding="utf-8")
    extra = psky.artefacts(yml)
    assert extra["shader_sha256"] == plugin_sha256(glsl)
