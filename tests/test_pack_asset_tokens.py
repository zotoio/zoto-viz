"""Unit tests for per-session pack asset HMAC tokens."""
from __future__ import annotations

import time

from service import pack_asset_tokens
from tests.pack_asset_test_util import SECRET, SESSION, mint


def test_mint_and_verify_round_trip() -> None:
    tok = mint("demo-pack", SESSION)
    assert pack_asset_tokens.verify_pack_asset_token(SECRET, "demo-pack", tok, session_id=SESSION)
    assert not pack_asset_tokens.verify_pack_asset_token(SECRET, "other-pack", tok, session_id=SESSION)
    assert not pack_asset_tokens.verify_pack_asset_token(SECRET, "demo-pack", tok, session_id="other-session")


def test_verify_rejects_non_ascii_token() -> None:
    tok = mint("demo-pack", SESSION)
    bad = tok + "\u00ff"
    assert not pack_asset_tokens.verify_pack_asset_token(SECRET, "demo-pack", bad, session_id=SESSION)


def test_verify_rejects_expired_token() -> None:
    tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, "demo-pack", ttl_s=60)
    parts = tok.split(".", 2)
    exp = int(parts[1])
    assert pack_asset_tokens.verify_pack_asset_token(
        SECRET, "demo-pack", tok, session_id=SESSION, now=exp - 1,
    )
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET, "demo-pack", tok, session_id=SESSION, now=exp + 1,
    )


def test_mint_requires_minimum_ttl() -> None:
    before = int(time.time())
    tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, "x", ttl_s=1)
    exp = int(tok.split(".", 2)[1])
    assert exp >= before + 60
