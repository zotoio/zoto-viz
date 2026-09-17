"""TypeSafe / Jev Sense proxy — API key stays in monitor process env only."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web

TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
TYPESAFE_MODEL = "jev-latest"
_REPO = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path | None = None) -> None:
    """Load KEY=VALUE pairs from `.env` when not already set in the process env."""
    env_file = path or (_REPO / ".env")
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, val = line.partition("=")
        if not sep:
            continue
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def api_key_configured() -> bool:
    return bool(os.environ.get("TYPESAFE_API_KEY", "").strip())


def _api_key() -> str:
    return os.environ.get("TYPESAFE_API_KEY", "").strip()


def _noul_questions(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        qid = str(row.get("id") or "").strip()
        prompt = str(row.get("prompt") or "").strip()
        if not qid or not prompt:
            continue
        out[qid] = {"type": "noul", "instructions": prompt}
    if not out:
        out["sense"] = {
            "type": "noul",
            "instructions": "Does the monitor state warrant attention?",
        }
    return out


async def api_status(_request: web.Request) -> web.Response:
    return web.json_response({"configured": api_key_configured()})


async def api_sense(request: web.Request) -> web.Response:
    if not api_key_configured():
        return web.json_response({"error": "typesafe not configured"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body must be an object"}, status=400)

    state = body.get("state")
    if state is None:
        return web.json_response({"error": "state is required"}, status=400)
    questions_raw = body.get("questions")
    rows = questions_raw if isinstance(questions_raw, list) else []
    payload = {
        "state": state,
        "model": TYPESAFE_MODEL,
        "questions": _noul_questions(rows),
    }
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(TYPESAFE_URL, json=payload, headers=headers, timeout=30) as resp:
                data = await resp.json(content_type=None)
                if resp.status >= 400:
                    return web.json_response(
                        {"error": "typesafe upstream error", "detail": data},
                        status=502,
                    )
    except aiohttp.ClientError as e:
        return web.json_response({"error": f"typesafe request failed: {e}"}, status=502)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=502)

    answers = data.get("answers") if isinstance(data, dict) else None
    return web.json_response({"answer": answers or data})
