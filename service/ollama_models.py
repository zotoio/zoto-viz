"""Popular Ollama tags plus a coarse VRAM check for the host GPU."""
from __future__ import annotations

import shutil
import subprocess
from typing import Any

# Disk / VRAM figures are Q4-ish published sizes, not exact GGUF bytes.
POPULAR: list[dict[str, Any]] = [
    {"id": "gemma4", "label": "Gemma 4", "sizeGb": 5.5, "vramGb": 6, "hint": "default small"},
    {"id": "gemma4:e4b", "label": "Gemma 4 E4B", "sizeGb": 8.0, "vramGb": 8, "hint": "CPU-safer on 0.31.x"},
    {"id": "gemma3:4b", "label": "Gemma 3 4B", "sizeGb": 3.3, "vramGb": 4},
    {"id": "llama3.2:3b", "label": "Llama 3.2 3B", "sizeGb": 2.0, "vramGb": 3},
    {"id": "llama3.1:8b", "label": "Llama 3.1 8B", "sizeGb": 4.7, "vramGb": 6},
    {"id": "llama3.1:70b", "label": "Llama 3.1 70B", "sizeGb": 40.0, "vramGb": 48},
    {"id": "qwen2.5:7b", "label": "Qwen 2.5 7B", "sizeGb": 4.7, "vramGb": 6},
    {"id": "qwen2.5:14b", "label": "Qwen 2.5 14B", "sizeGb": 9.0, "vramGb": 12},
    {"id": "qwen2.5:32b", "label": "Qwen 2.5 32B", "sizeGb": 20.0, "vramGb": 24},
    {"id": "mistral", "label": "Mistral 7B", "sizeGb": 4.1, "vramGb": 6},
    {"id": "mistral-small", "label": "Mistral Small", "sizeGb": 12.0, "vramGb": 16},
    {"id": "phi4", "label": "Phi-4", "sizeGb": 9.1, "vramGb": 12},
    {"id": "phi3:mini", "label": "Phi-3 Mini", "sizeGb": 2.2, "vramGb": 3},
    {"id": "deepseek-r1:8b", "label": "DeepSeek R1 8B", "sizeGb": 5.2, "vramGb": 8},
    {"id": "deepseek-r1:32b", "label": "DeepSeek R1 32B", "sizeGb": 20.0, "vramGb": 24},
    {"id": "codellama:7b", "label": "Code Llama 7B", "sizeGb": 3.8, "vramGb": 6},
]


def _run(cmd: list[str], timeout: float = 2.0) -> str:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (out.stdout or "").strip()


def detect_vram_gb() -> tuple[float | None, str | None]:
    """Best-effort device VRAM in GiB. ``(None, None)`` when unknown."""
    if shutil.which("nvidia-smi"):
        raw = _run([
            "nvidia-smi",
            "--query-gpu=memory.total",
            "--format=csv,noheader,nounits",
        ])
        megs: list[float] = []
        for line in raw.splitlines():
            try:
                megs.append(float(line.strip()))
            except ValueError:
                continue
        if megs:
            return round(max(megs) / 1024.0, 1), "nvidia"
    if shutil.which("rocm-smi"):
        raw = _run(["rocm-smi", "--showmeminfo", "vram"])
        if raw:
            for token in raw.replace(",", " ").split():
                if token.isdigit() and int(token) > 256:
                    return round(int(token) / 1024.0, 1), "amd"
    return None, None


def _installed_name(tag: str, names: list[str]) -> str | None:
    if tag in names:
        return tag
    hits = [n for n in names if n == tag or n.startswith(tag + ":")]
    return hits[0] if hits else None


def warning_for(vram_need: float, device_gb: float | None) -> str | None:
    if device_gb is None:
        if vram_need >= 16:
            return f"needs ~{vram_need:g} GB VRAM — check this machine before pulling"
        return None
    if device_gb <= 0:
        if vram_need >= 4:
            return f"needs ~{vram_need:g} GB VRAM — this host looks CPU-only"
        return None
    if vram_need > device_gb * 0.9:
        return f"needs ~{vram_need:g} GB VRAM; this GPU has {device_gb:g} GB"
    return None


def catalog(names: list[str], sizes: dict[str, int] | None = None) -> dict[str, Any]:
    """Installed tags plus popular pulls, with a VRAM warning when the GPU is small."""
    names = [str(n) for n in names if n]
    sizes = sizes or {}
    device_gb, gpu = detect_vram_gb()
    installed: list[dict[str, Any]] = []
    for name in names:
        raw = int(sizes.get(name) or 0)
        installed.append({
            "name": name,
            "size": raw,
            "sizeGb": round(raw / 1_000_000_000, 2) if raw else None,
        })
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in POPULAR:
        tag = str(row["id"])
        hit = _installed_name(tag, names)
        warn = warning_for(float(row["vramGb"]), device_gb)
        item = {
            "id": tag,
            "label": row["label"],
            "sizeGb": row["sizeGb"],
            "vramGb": row["vramGb"],
            "installed": bool(hit),
            "name": hit or tag,
            "pull": not hit,
        }
        if row.get("hint"):
            item["hint"] = row["hint"]
        if warn and not hit:
            item["warning"] = warn
        rows.append(item)
        seen.add(tag)
        if hit:
            seen.add(hit)
    for name in names:
        if name in seen:
            continue
        raw = int(sizes.get(name) or 0)
        rows.append({
            "id": name,
            "label": name,
            "name": name,
            "sizeGb": round(raw / 1_000_000_000, 2) if raw else None,
            "installed": True,
            "pull": False,
            "hint": "installed",
        })
    return {
        "installed": installed,
        "catalog": rows,
        "vramGb": device_gb,
        "gpu": gpu,
    }
