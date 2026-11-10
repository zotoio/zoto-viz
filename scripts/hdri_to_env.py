#!/usr/bin/env python3
"""Convert a Radiance .hdr equirect (e.g. a Poly Haven 1k HDRI) into an LDR sRGB environment image.

The host builds a PMREM from the result for HD host-mesh packs (``role: environment`` asset), so the
image only has to carry lighting, not a perfect background. Exposure is normalised so the median
luminance lands on ``--median`` (linear), and highlights roll off with a soft shoulder above
``--knee`` instead of clipping. Deterministic: same input and flags give the same bytes.

    python3 scripts/hdri_to_env.py in.hdr plugins/src/<id>/assets/env-hd.jpg --width 1024
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def read_hdr(path: Path) -> np.ndarray:
    """Radiance RGBE (flat or new-style RLE scanlines) -> float32 HxWx3 linear RGB."""
    data = path.read_bytes()
    pos = 0
    fmt = ""
    while True:
        end = data.index(b"\n", pos)
        line = data[pos:end].decode("ascii", "replace").strip()
        pos = end + 1
        if line.startswith("FORMAT="):
            fmt = line.split("=", 1)[1]
        if not line:
            break
    if fmt and fmt != "32-bit_rle_rgbe":
        raise ValueError(f"unsupported HDR format {fmt!r}")
    end = data.index(b"\n", pos)
    m = re.fullmatch(r"-Y (\d+) \+X (\d+)", data[pos:end].decode("ascii").strip())
    if not m:
        raise ValueError("only -Y H +X W orientation is supported")
    h, w = int(m.group(1)), int(m.group(2))
    pos = end + 1
    buf = np.frombuffer(data, dtype=np.uint8, offset=pos)
    out = np.empty((h, w, 4), dtype=np.uint8)
    i = 0
    for y in range(h):
        if w < 8 or w > 0x7FFF or buf[i] != 2 or buf[i + 1] != 2 or buf[i + 2] & 0x80:
            out[y] = buf[i : i + w * 4].reshape(w, 4)
            i += w * 4
            continue
        if (int(buf[i + 2]) << 8 | int(buf[i + 3])) != w:
            raise ValueError("bad RLE scanline width")
        i += 4
        for c in range(4):
            x = 0
            row = out[y, :, c]
            while x < w:
                n = int(buf[i])
                i += 1
                if n > 128:
                    n -= 128
                    row[x : x + n] = buf[i]
                    i += 1
                else:
                    row[x : x + n] = buf[i : i + n]
                    i += n
                x += n
    e = out[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0).astype(np.float32)
    return out[..., :3].astype(np.float32) * scale[..., None]


def tone(rgb: np.ndarray, median: float, knee: float) -> np.ndarray:
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    rgb = rgb * (median / max(float(np.median(lum)), 1e-6))
    # soft shoulder: identity below the knee, asymptotic to 1.0 above it
    over = np.maximum(rgb - knee, 0.0)
    span = 1.0 - knee
    return np.where(rgb > knee, knee + span * (over / (over + span)), rgb)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("src", type=Path)
    ap.add_argument("dest", type=Path, help=".jpg, .png or .webp")
    ap.add_argument("--width", type=int, default=1024, help="output width (height is width/2)")
    ap.add_argument("--median", type=float, default=0.18, help="linear median luminance after exposure")
    ap.add_argument("--knee", type=float, default=0.7, help="linear value where the highlight shoulder starts")
    ap.add_argument("--quality", type=int, default=86, help="JPEG/WebP quality")
    args = ap.parse_args(argv)
    rgb = tone(read_hdr(args.src), args.median, args.knee)
    img = Image.fromarray((linear_to_srgb(rgb) * 255.0 + 0.5).astype(np.uint8), "RGB")
    if img.width != args.width:
        img = img.resize((args.width, args.width // 2), Image.Resampling.LANCZOS)
    args.dest.parent.mkdir(parents=True, exist_ok=True)
    suffix = args.dest.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        img.save(args.dest, "JPEG", quality=args.quality, optimize=True, progressive=False, subsampling=0)
    elif suffix == ".webp":
        img.save(args.dest, "WEBP", quality=args.quality, method=6)
    elif suffix == ".png":
        img.save(args.dest, "PNG", optimize=True)
    else:
        raise SystemExit(f"unsupported output {suffix}")
    print(f"{args.src.name} -> {args.dest} {img.width}x{img.height} {args.dest.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
