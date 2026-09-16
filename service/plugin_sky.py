"""Plugin far-field sky: ``sky/fragment.glsl`` hash, uniform whitelist, catalog flags.

Served by ``service.plugins.api_sky`` only after source-review consent. Compile-time
uniform rejection is fail-closed: a non-whitelisted ``uniform`` makes the sky
unavailable and the host keeps the shipped backdrop.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .plugin_zip import plugin_sha256

SHADER_REL = "sky/fragment.glsl"
SHADER_MAX = 16_000
ALLOWED_UNIFORMS = frozenset({"uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg"})
BANNED_UNIFORMS = frozenset({
    "uMode", "uMotif", "uA", "uB", "uWarp", "uGrain", "uBands",
    "projectionMatrix", "modelViewMatrix", "cameraPosition",
})
AWAITING_REVIEW = "awaiting review"

_UNIFORM_RE = re.compile(
    r"\buniform\s+(?:(?:highp|mediump|lowp)\s+)?"
    r"(?:float|vec[234]|int|uint|bool|mat[234]|sampler(?:2D|3D|Cube))\s+(\w+)\s*;"
)
_INCLUDE_RE = re.compile(r"#\s*include\b|\bimport\s", re.I)


def shader_file(home: Path) -> Path:
    return Path(home) / "sky" / "fragment.glsl"


def artefacts(path: Path) -> dict[str, Any]:
    """``shader_sha256`` when ``sky/fragment.glsl`` exists. Does not read GLSL semantics."""
    home = Path(path)
    if home.name in ("plugin.yml", "plugin.yaml"):
        home = home.parent
    extra: dict[str, Any] = {}
    glsl = shader_file(home)
    try:
        if glsl.is_file():
            extra["shader_sha256"] = plugin_sha256(glsl)
    except OSError:
        return extra
    return extra


def validate_source(src: str) -> str | None:
    """Return an error string, or None if the fragment may be compiled."""
    text = src.strip()
    if not text:
        return "empty shader"
    if len(src) > SHADER_MAX:
        return "shader too long"
    if _INCLUDE_RE.search(src):
        return "shader includes are not allowed"
    names = _UNIFORM_RE.findall(src)
    for name in names:
        if name not in ALLOWED_UNIFORMS:
            return f"non-whitelisted uniform {name}"
    for banned in BANNED_UNIFORMS:
        if re.search(rf"\buniform\b[^;]*\b{re.escape(banned)}\b", src):
            return f"non-whitelisted uniform {banned}"
    if not re.search(r"\bvoid\s+main\s*\(", src):
        return "shader needs void main()"
    return None


def catalog(row: dict[str, Any], home: Path, *, allowed: bool) -> dict[str, Any]:
    """Sky availability for the ``/api/plugins`` payload. Fail closed without consent."""
    glsl = shader_file(home)
    has = bool(row.get("has_sky_shader")) or glsl.is_file()
    if not has:
        return {"sky_available": False}
    if not allowed:
        return {"sky_available": False, "sky_error": AWAITING_REVIEW}
    try:
        src = glsl.read_text(encoding="utf-8")
    except OSError:
        return {"sky_available": False, "sky_error": "compile error: missing fragment"}
    err = validate_source(src)
    if err:
        return {"sky_available": False, "sky_error": f"compile error: {err}"}
    return {"sky_available": True}
