"""Google Nest Device Access (SDM): OAuth, Pub/Sub events, camera stills, WebRTC.

Config: ``~/.zoto-viz/sdm.yml`` (mode 600). Tokens never go to the browser.
Pub/Sub pull uses Application Default Credentials (gcloud ADC / service account);
camera commands use the PCM user refresh token (``sdm.service``).
"""
from __future__ import annotations

import base64
import contextlib
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import yaml
from aiohttp import ClientError, ClientSession, ClientTimeout, web

from . import paths

SDM_SCOPE = "https://www.googleapis.com/auth/sdm.service"
PUBSUB_SCOPE = "https://www.googleapis.com/auth/pubsub"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SDM_API = "https://smartdevicemanagement.googleapis.com/v1"
PCM_BASE = "https://nestservices.google.com/partnerconnections"
REDIRECT = "https://www.google.com"
DEFAULT_GCP = "gen-lang-client-0973407358"
DEFAULT_TOPIC = "sdm-events"
DEFAULT_SUB = "sdm-events-zoto"
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,128}$")
EVENT_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{4,200}$")
MAX_EVENTS = 40
MAX_DEVICES = 32
FETCH_S = 20
POLL_S = 4
LIST_MIN_S = 120
LIST_RETRY_S = 45
PUBSUB_MAX = 20
STILL_TTL_S = 3600

_cfg: dict[str, Any] = {}
_loaded = False
_session: ClientSession | None = None
_devices: list[dict[str, Any]] = []
_events: list[dict[str, Any]] = []
_error: str = ""
_last_list = 0.0
_list_attempt = 0.0
_last_pubsub = 0.0
_gcp_token: str = ""
_gcp_expiry = 0.0
_pending_code = ""


def reset_for_tests() -> None:
    global _cfg, _loaded, _devices, _events, _error, _last_list, _list_attempt, _last_pubsub, _gcp_token, _gcp_expiry, _pending_code
    _cfg = {}
    _loaded = False
    _devices = []
    _events = []
    _error = ""
    _last_list = 0.0
    _list_attempt = 0.0
    _last_pubsub = 0.0
    _gcp_token = ""
    _gcp_expiry = 0.0
    _pending_code = ""


def sdm_file() -> Path:
    d = paths.user_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "sdm.yml"


def stills_dir(*, create: bool = False) -> Path:
    d = paths.user_dir() / "sdm" / "stills"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def default_config() -> dict[str, Any]:
    gcp = DEFAULT_GCP
    return {
        "gcp_project": gcp,
        "enterprise_id": "",
        "redirect_uri": REDIRECT,
        "oauth": {"client_id": "", "client_secret": ""},
        "tokens": {"refresh_token": "", "access_token": "", "expiry": 0},
        "pubsub": {
            "topic": f"projects/{gcp}/topics/{DEFAULT_TOPIC}",
            "subscription": f"projects/{gcp}/subscriptions/{DEFAULT_SUB}",
        },
    }


def _merge(raw: Any) -> dict[str, Any]:
    out = default_config()
    if not isinstance(raw, dict):
        return out
    gcp = str(raw.get("gcp_project") or out["gcp_project"]).strip() or DEFAULT_GCP
    out["gcp_project"] = gcp
    ent = str(raw.get("enterprise_id") or "").strip()
    out["enterprise_id"] = ent if UUID_RE.match(ent) else ""
    redir = str(raw.get("redirect_uri") or REDIRECT).strip() or REDIRECT
    out["redirect_uri"] = redir
    oauth = raw.get("oauth") if isinstance(raw.get("oauth"), dict) else {}
    out["oauth"] = {
        "client_id": str(oauth.get("client_id") or "").strip(),
        "client_secret": str(oauth.get("client_secret") or "").strip(),
    }
    tok = raw.get("tokens") if isinstance(raw.get("tokens"), dict) else {}
    try:
        expiry = int(tok.get("expiry") or 0)
    except (TypeError, ValueError):
        expiry = 0
    out["tokens"] = {
        "refresh_token": str(tok.get("refresh_token") or "").strip(),
        "access_token": str(tok.get("access_token") or "").strip(),
        "expiry": expiry,
    }
    pub = raw.get("pubsub") if isinstance(raw.get("pubsub"), dict) else {}
    topic = str(pub.get("topic") or "").strip() or f"projects/{gcp}/topics/{DEFAULT_TOPIC}"
    sub = str(pub.get("subscription") or "").strip() or f"projects/{gcp}/subscriptions/{DEFAULT_SUB}"
    out["pubsub"] = {"topic": topic, "subscription": sub}
    return out


def load() -> dict[str, Any]:
    global _cfg, _loaded
    if _loaded:
        return _cfg
    path = sdm_file()
    raw: Any = None
    if path.is_file():
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError):
            raw = None
    _cfg = _merge(raw)
    _loaded = True
    return _cfg


def save(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    global _cfg, _loaded
    _cfg = _merge(cfg if cfg is not None else _cfg)
    _loaded = True
    path = sdm_file()
    path.write_text(yaml.safe_dump(_cfg, sort_keys=False), encoding="utf-8")
    path.chmod(0o600)
    return _cfg


def ensure() -> dict[str, Any]:
    cfg = load()
    if not sdm_file().is_file():
        save(cfg)
    return cfg


def pcm_url(cfg: dict[str, Any] | None = None) -> str | None:
    c = cfg or load()
    ent = c.get("enterprise_id") or ""
    cid = (c.get("oauth") or {}).get("client_id") or ""
    if not ent or not cid:
        return None
    q = urlencode({
        "redirect_uri": c.get("redirect_uri") or REDIRECT,
        "access_type": "offline",
        "prompt": "consent",
        "client_id": cid,
        "response_type": "code",
        "scope": SDM_SCOPE,
    })
    return f"{PCM_BASE}/{ent}/auth?{q}"


def status_payload() -> dict[str, Any]:
    c = load()
    oauth = c.get("oauth") or {}
    tok = c.get("tokens") or {}
    pub = c.get("pubsub") or {}
    linked = bool(tok.get("refresh_token"))
    return {
        "gcp_project": c.get("gcp_project"),
        "enterprise_id": c.get("enterprise_id") or "",
        "redirect_uri": c.get("redirect_uri") or REDIRECT,
        "client_id": oauth.get("client_id") or "",
        "has_client_secret": bool(oauth.get("client_secret")),
        "linked": linked,
        "access_expires": int(tok.get("expiry") or 0),
        "pcm_url": pcm_url(c),
        "pubsub": pub,
        "devices": list(_devices),
        "events": list(_events),
        "error": _error,
        "last_list": _last_list or None,
        "last_pubsub": _last_pubsub or None,
    }


def snapshot() -> dict[str, Any]:
    return status_payload()


def apply(msg: dict[str, Any]) -> dict[str, Any]:
    msg["sdm"] = snapshot()
    return msg


def upsert(body: dict[str, Any]) -> dict[str, Any]:
    c = load()
    if "gcp_project" in body:
        c["gcp_project"] = str(body.get("gcp_project") or "").strip() or DEFAULT_GCP
    if "enterprise_id" in body:
        ent = str(body.get("enterprise_id") or "").strip()
        if ent and not UUID_RE.match(ent):
            raise ValueError("enterprise_id must be a Device Access UUID")
        c["enterprise_id"] = ent
    if "redirect_uri" in body:
        c["redirect_uri"] = str(body.get("redirect_uri") or REDIRECT).strip() or REDIRECT
    oauth = dict(c.get("oauth") or {})
    if "client_id" in body:
        oauth["client_id"] = str(body.get("client_id") or "").strip()
    if "client_secret" in body:
        oauth["client_secret"] = str(body.get("client_secret") or "").strip()
    c["oauth"] = oauth
    pub = dict(c.get("pubsub") or {})
    if "topic" in body:
        pub["topic"] = str(body.get("topic") or "").strip()
    if "subscription" in body:
        pub["subscription"] = str(body.get("subscription") or "").strip()
    c["pubsub"] = pub
    return save(c)


def queue_code(code: str) -> None:
    """PCM authorization code for the next ``poll()`` / ``flush_code()``."""
    global _pending_code
    raw = (code or "").strip()
    if not raw or len(raw) > 512:
        raise ValueError("authorization code required")
    _pending_code = raw


def _session_get() -> ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = ClientSession(timeout=ClientTimeout(total=FETCH_S))
    return _session


async def close() -> None:
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
    _session = None


def _store_tokens(data: dict[str, Any]) -> dict[str, Any]:
    c = load()
    tok = dict(c.get("tokens") or {})
    if data.get("access_token"):
        tok["access_token"] = str(data["access_token"])
        tok["expiry"] = int(time.time()) + int(data.get("expires_in") or 3600) - 60
    if data.get("refresh_token"):
        tok["refresh_token"] = str(data["refresh_token"])
    c["tokens"] = tok
    save(c)
    return tok


async def _post_form(url: str, fields: dict[str, str]) -> dict[str, Any]:
    session = _session_get()
    async with session.post(url, data=fields) as resp:
        text = await resp.text()
        try:
            data = json.loads(text) if text else {}
        except json.JSONDecodeError as e:
            raise ValueError(f"oauth: {text[:200] or resp.status}") from e
        if resp.status >= 400 or data.get("error"):
            err = data.get("error_description") or data.get("error") or text[:200]
            raise ValueError(f"oauth: {err}")
        if not isinstance(data, dict):
            raise ValueError("oauth: bad payload")
        return data


async def exchange_code(code: str) -> dict[str, Any]:
    raw = (code or "").strip()
    if not raw or len(raw) > 512:
        raise ValueError("authorization code required")
    c = load()
    oauth = c.get("oauth") or {}
    cid, secret = oauth.get("client_id") or "", oauth.get("client_secret") or ""
    if not cid or not secret:
        raise ValueError("OAuth client_id and client_secret required")
    data = await _post_form(TOKEN_URL, {
        "client_id": cid,
        "client_secret": secret,
        "code": raw,
        "grant_type": "authorization_code",
        "redirect_uri": c.get("redirect_uri") or REDIRECT,
    })
    _store_tokens(data)
    return status_payload()


async def refresh_access(*, force: bool = False) -> str:
    c = load()
    tok = c.get("tokens") or {}
    access = str(tok.get("access_token") or "")
    expiry = int(tok.get("expiry") or 0)
    if access and not force and expiry > time.time() + 30:
        return access
    refresh = str(tok.get("refresh_token") or "")
    if not refresh:
        raise ValueError("not linked — complete PCM OAuth")
    oauth = c.get("oauth") or {}
    data = await _post_form(TOKEN_URL, {
        "client_id": oauth.get("client_id") or "",
        "client_secret": oauth.get("client_secret") or "",
        "refresh_token": refresh,
        "grant_type": "refresh_token",
    })
    tok = _store_tokens(data)
    access = str(tok.get("access_token") or "")
    if not access:
        raise ValueError("oauth: no access_token")
    return access


def parse_device(raw: dict[str, Any]) -> dict[str, Any] | None:
    name = str(raw.get("name") or "")
    if "/devices/" not in name:
        return None
    did = name.rsplit("/", 1)[-1]
    if not DEVICE_ID_RE.match(did):
        return None
    traits = raw.get("traits") if isinstance(raw.get("traits"), dict) else {}
    info = traits.get("sdm.devices.traits.Info") if isinstance(traits.get("sdm.devices.traits.Info"), dict) else {}
    live = traits.get("sdm.devices.traits.CameraLiveStream")
    live = live if isinstance(live, dict) else {}
    protocols = [str(p) for p in (live.get("supportedProtocols") or []) if p]
    rels = raw.get("parentRelations") if isinstance(raw.get("parentRelations"), list) else []
    room = ""
    if rels and isinstance(rels[0], dict):
        room = str(rels[0].get("displayName") or "")
    kind = str(raw.get("type") or "").rsplit(".", 1)[-1].lower()
    return {
        "id": did,
        "name": name,
        "type": kind,
        "label": str(info.get("customName") or room or did),
        "room": room,
        "protocols": protocols,
        "webrtc": not protocols or "WEB_RTC" in protocols,
        "rtsp": "RTSP" in protocols,
        "camera": kind in ("camera", "doorbell"),
    }


def parse_pubsub_message(raw: dict[str, Any]) -> dict[str, Any] | None:
    data = raw.get("data")
    if isinstance(data, str):
        try:
            pad = "=" * (-len(data) % 4)
            blob = base64.urlsafe_b64decode(data + pad)
            payload = json.loads(blob.decode("utf-8"))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            return None
    elif isinstance(data, dict):
        payload = data
    else:
        return None
    if not isinstance(payload, dict):
        return None
    update = payload.get("resourceUpdate") if isinstance(payload.get("resourceUpdate"), dict) else {}
    name = str(update.get("name") or payload.get("resource") or "")
    did = name.rsplit("/", 1)[-1] if "/devices/" in name else ""
    events = update.get("events") if isinstance(update.get("events"), dict) else {}
    kinds: list[str] = []
    event_id = ""
    for key, body in events.items():
        kinds.append(str(key).rsplit(".", 1)[-1])
        if isinstance(body, dict) and not event_id:
            event_id = str(body.get("eventId") or body.get("eventSessionId") or "")
    if not kinds and isinstance(payload.get("eventId"), str):
        kinds = ["resource"]
        event_id = str(payload.get("eventId") or "")
    if not kinds:
        return None
    return {
        "ts": str(payload.get("timestamp") or ""),
        "device": did,
        "kinds": kinds[:8],
        "event_id": event_id,
        "resource": name,
    }


async def _sdm_json(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    token = await refresh_access()
    session = _session_get()
    url = f"{SDM_API}/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with session.request(method, url, json=body, headers=headers) as resp:
        text = await resp.text()
        try:
            data = json.loads(text) if text else {}
        except json.JSONDecodeError:
            data = {}
        if resp.status >= 400:
            err = ""
            if isinstance(data, dict):
                inner = data.get("error")
                if isinstance(inner, dict):
                    err = str(inner.get("message") or inner.get("status") or "")
                elif inner:
                    err = str(inner)
            raise ValueError(err or text[:240] or f"sdm {resp.status}")
        return data if isinstance(data, dict) else {}


def _enterprise() -> str:
    ent = load().get("enterprise_id") or ""
    if not UUID_RE.match(str(ent)):
        raise ValueError("Device Access enterprise_id required")
    return str(ent)


async def list_devices() -> list[dict[str, Any]]:
    global _devices, _last_list, _error
    ent = _enterprise()
    data = await _sdm_json("GET", f"enterprises/{ent}/devices")
    rows = []
    for item in data.get("devices") or []:
        if isinstance(item, dict):
            parsed = parse_device(item)
            if parsed:
                rows.append(parsed)
        if len(rows) >= MAX_DEVICES:
            break
    _devices = rows
    _last_list = time.time()
    _error = ""
    return rows


async def execute_command(device_id: str, command: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    did = (device_id or "").strip()
    if not DEVICE_ID_RE.match(did):
        raise ValueError("device id required")
    ent = _enterprise()
    data = await _sdm_json(
        "POST",
        f"enterprises/{ent}/devices/{did}:executeCommand",
        {"command": command, "params": params or {}},
    )
    results = data.get("results")
    return results if isinstance(results, dict) else data


def normalize_offer_sdp(offer: str) -> str:
    s = (offer or "").replace("\r\n", "\n").strip()
    if not s:
        raise ValueError("offerSdp required")
    if not s.endswith("\n"):
        s += "\n"
    return s


def _sdp_lines(sdp: str) -> tuple[list[str], str]:
    nl = "\r\n" if "\r\n" in sdp else "\n"
    return sdp.replace("\r\n", "\n").replace("\r", "\n").split("\n"), nl


def _sdp_direction(sdp: str, kind: str) -> str:
    in_sec = False
    for line in _sdp_lines(sdp)[0]:
        if line.startswith("m="):
            in_sec = line.startswith(f"m={kind}")
        elif in_sec and line.startswith("a="):
            for d in ("sendrecv", "sendonly", "recvonly", "inactive"):
                if line == f"a={d}" or line.startswith(f"a={d}:"):
                    return d
    return ""


def fix_sdp_answer(offer_sdp: str, answer_sdp: str) -> str:
    """Repair Nest answer SDP for Chromium >= 143 and Firefox.

    Google answers ``a=sendrecv`` to a ``a=recvonly`` offer (RFC 3264 wants
    ``sendonly``). Some answers also omit the ICE candidate foundation.
    """
    if not (offer_sdp or "").strip() or not (answer_sdp or "").strip():
        return answer_sdp
    lines, nl = _sdp_lines(answer_sdp)
    out: list[str] = []
    kind = ""
    cand = 1
    for line in lines:
        if line.startswith("m="):
            kind = line[2:].split(" ", 1)[0]
        if kind in ("audio", "video") and line == "a=sendrecv" and _sdp_direction(offer_sdp, kind) == "recvonly":
            out.append("a=sendonly")
            continue
        if line.startswith("a=candidate: "):
            out.append(line.replace("a=candidate: ", f"a=candidate:{cand} ", 1))
            cand += 1
            continue
        out.append(line)
    text = nl.join(out)
    if answer_sdp.endswith("\n") and not text.endswith(nl):
        text += nl
    return text


async def generate_webrtc(device_id: str, offer_sdp: str) -> dict[str, Any]:
    offer = normalize_offer_sdp(offer_sdp)
    out = await execute_command(
        device_id,
        "sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream",
        {"offerSdp": offer},
    )
    answer = str(out.get("answerSdp") or "")
    if answer:
        return {**out, "answerSdp": fix_sdp_answer(offer, answer)}
    return out


async def extend_webrtc(device_id: str, media_session_id: str) -> dict[str, Any]:
    sid = (media_session_id or "").strip()
    if not sid:
        raise ValueError("mediaSessionId required")
    return await execute_command(
        device_id,
        "sdm.devices.commands.CameraLiveStream.ExtendWebRtcStream",
        {"mediaSessionId": sid},
    )


async def stop_webrtc(device_id: str, media_session_id: str) -> dict[str, Any]:
    sid = (media_session_id or "").strip()
    if not sid:
        raise ValueError("mediaSessionId required")
    return await execute_command(
        device_id,
        "sdm.devices.commands.CameraLiveStream.StopWebRtcStream",
        {"mediaSessionId": sid},
    )


def still_path(device_id: str, event_id: str) -> Path:
    safe_d = quote(device_id, safe="")
    safe_e = quote(event_id, safe="")
    return stills_dir(create=True) / f"{safe_d}__{safe_e}.jpg"


async def generate_still(device_id: str, event_id: str) -> Path:
    eid = (event_id or "").strip()
    if not EVENT_ID_RE.match(eid):
        raise ValueError("event id required")
    path = still_path(device_id, eid)
    if path.is_file() and time.time() - path.stat().st_mtime < STILL_TTL_S:
        return path
    results = await execute_command(
        device_id,
        "sdm.devices.commands.CameraEventImage.GenerateImage",
        {"eventId": eid},
    )
    url = str(results.get("url") or "")
    token = str(results.get("token") or "")
    if not url.startswith("https://") or not token:
        raise ValueError("still url missing")
    session = _session_get()
    async with session.get(url, headers={"Authorization": token}) as resp:
        if resp.status >= 400:
            raise ValueError(f"still fetch {resp.status}")
        blob = await resp.read()
    if len(blob) < 32 or len(blob) > 8_000_000:
        raise ValueError("still too small or too large")
    path.write_bytes(blob)
    return path


def _gcp_adc_token() -> str | None:
    global _gcp_token, _gcp_expiry
    if _gcp_token and _gcp_expiry > time.time() + 30:
        return _gcp_token
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError:
        return None
    try:
        creds, _ = google.auth.default(scopes=[PUBSUB_SCOPE])
        if not creds.valid:
            creds.refresh(Request())
        token = getattr(creds, "token", None)
        if not token:
            return None
        expiry = getattr(creds, "expiry", None)
        _gcp_token = str(token)
        if expiry is not None:
            _gcp_expiry = expiry.timestamp() if hasattr(expiry, "timestamp") else time.time() + 1800
        else:
            _gcp_expiry = time.time() + 1800
        return _gcp_token
    except Exception:
        return None


async def pull_events() -> list[dict[str, Any]]:
    global _events, _last_pubsub, _error
    sub = (load().get("pubsub") or {}).get("subscription") or ""
    if not str(sub).startswith("projects/"):
        return []
    token = _gcp_adc_token()
    if not token:
        return []
    session = _session_get()
    url = f"https://pubsub.googleapis.com/v1/{sub}:pull"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    ack_ids: list[str] = []
    new_rows: list[dict[str, Any]] = []
    async with session.post(url, json={"maxMessages": PUBSUB_MAX}, headers=headers) as resp:
        text = await resp.text()
        if resp.status >= 400:
            _error = f"pubsub {resp.status}: {text[:180]}"
            return []
        try:
            data = json.loads(text) if text else {}
        except json.JSONDecodeError:
            return []
    for rec in data.get("receivedMessages") or []:
        if not isinstance(rec, dict):
            continue
        ack = str(rec.get("ackId") or "")
        if ack:
            ack_ids.append(ack)
        msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
        parsed = parse_pubsub_message(msg)
        if parsed:
            new_rows.append(parsed)
    if ack_ids:
        ack_url = f"https://pubsub.googleapis.com/v1/{sub}:acknowledge"
        try:
            async with session.post(ack_url, json={"ackIds": ack_ids}, headers=headers) as ack:
                await ack.read()
        except (ClientError, Exception):
            pass
    if new_rows:
        _events = (new_rows + _events)[:MAX_EVENTS]
    _last_pubsub = time.time()
    return new_rows


async def poll() -> None:
    global _error, _pending_code, _list_attempt
    ensure()
    if _pending_code:
        code, _pending_code = _pending_code, ""
        try:
            await exchange_code(code)
        except ValueError as e:
            _error = str(e)[:240]
            return
    c = load()
    if not (c.get("tokens") or {}).get("refresh_token"):
        return
    now = time.time()
    stale = not _devices or (now - _last_list) >= LIST_MIN_S
    if stale and (now - _list_attempt) >= LIST_RETRY_S:
        _list_attempt = now
        try:
            await list_devices()
        except ValueError as e:
            _error = str(e)[:240]
    try:
        await pull_events()
    except (ValueError, ClientError) as e:
        _error = str(e)[:240]


async def api_sdm(request: web.Request) -> web.Response:
    if request.method == "GET":
        return web.json_response({"ok": True, **status_payload()})
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "json required"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    try:
        if body.get("code"):
            await exchange_code(str(body.get("code") or ""))
            with contextlib.suppress(ValueError):
                await list_devices()
        else:
            upsert(body)
        return web.json_response({"ok": True, **status_payload()})
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)


async def api_devices(request: web.Request) -> web.Response:
    try:
        rows = await list_devices()
        return web.json_response({"ok": True, "devices": rows})
    except ValueError as e:
        return web.json_response({"error": str(e), "devices": list(_devices)}, status=400)


async def api_webrtc(request: web.Request) -> web.Response:
    did = str(request.match_info.get("id") or "")
    try:
        body = await request.json()
    except json.JSONDecodeError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    try:
        if body.get("stop") and body.get("mediaSessionId"):
            out = await stop_webrtc(did, str(body.get("mediaSessionId") or ""))
        elif body.get("extend") and body.get("mediaSessionId"):
            out = await extend_webrtc(did, str(body.get("mediaSessionId") or ""))
        else:
            out = await generate_webrtc(did, str(body.get("offerSdp") or ""))
        return web.json_response({"ok": True, **out})
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)


async def api_still(request: web.Request) -> web.StreamResponse:
    did = str(request.query.get("device") or "").strip()
    eid = str(request.query.get("event") or "").strip()
    if not DEVICE_ID_RE.match(did) or not EVENT_ID_RE.match(eid):
        return web.json_response({"error": "device and event required"}, status=400)
    try:
        path = await generate_still(did, eid)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.FileResponse(path, headers={"Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300"})
