"""Unit tests for frame-bound pack asset HMAC tokens."""
from __future__ import annotations

import time

from service import pack_asset_frames, pack_asset_tokens
from tests.pack_asset_test_util import DEFAULT_FRAME, SECRET, SESSION, mint, new_frame_id


def test_mint_and_verify_round_trip() -> None:
    reg = pack_asset_frames.PackAssetFrameRegistry()
    reg.register(SESSION, DEFAULT_FRAME)
    tok = mint("demo-pack", SESSION)
    assert pack_asset_tokens.verify_pack_asset_token(
        SECRET, "demo-pack", tok, session_id=SESSION, frame_live=reg.is_live(SESSION, DEFAULT_FRAME),
    )
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET, "other-pack", tok, session_id=SESSION, frame_live=True,
    )
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET, "demo-pack", tok, session_id="other-session", frame_live=True,
    )


def test_encoding_ab_c_vs_a_bc() -> None:
    """Session ab + pack c must not verify as session a + pack bc."""
    frame = new_frame_id()
    reg = pack_asset_frames.PackAssetFrameRegistry()
    reg.register("ab", frame)
    tok = pack_asset_tokens.mint_pack_asset_token(SECRET, "ab", "c", frame)
    assert pack_asset_tokens.verify_pack_asset_token(SECRET, "c", tok, session_id="ab", frame_live=True)
    assert not pack_asset_tokens.verify_pack_asset_token(SECRET, "bc", tok, session_id="a", frame_live=True)


def test_verify_rejects_non_ascii_token() -> None:
    tok = mint("demo-pack", SESSION)
    bad = tok + "\u00ff"
    assert not pack_asset_tokens.verify_pack_asset_token(SECRET, "demo-pack", bad, session_id=SESSION, frame_live=True)


def test_revoked_frame_denied() -> None:
    frame = new_frame_id()
    reg = pack_asset_frames.PackAssetFrameRegistry()
    reg.register(SESSION, frame)
    tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, "demo-pack", frame)
    assert pack_asset_tokens.verify_pack_asset_token(
        SECRET, "demo-pack", tok, session_id=SESSION, frame_live=reg.is_live(SESSION, frame),
    )
    reg.unregister(SESSION, frame)
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET, "demo-pack", tok, session_id=SESSION, frame_live=reg.is_live(SESSION, frame),
    )


def test_absolute_ttl_cap() -> None:
    frame = new_frame_id()
    reg = pack_asset_frames.PackAssetFrameRegistry()
    t0 = 1_700_000_000.0
    reg.register(SESSION, frame, now=t0)
    tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, "demo-pack", frame)
    assert pack_asset_tokens.verify_pack_asset_token(
        SECRET,
        "demo-pack",
        tok,
        session_id=SESSION,
        frame_live=reg.is_live(SESSION, frame, now=t0 + pack_asset_frames.FRAME_ABSOLUTE_TTL_S - 1),
    )
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET,
        "demo-pack",
        tok,
        session_id=SESSION,
        frame_live=reg.is_live(SESSION, frame, now=t0 + pack_asset_frames.FRAME_ABSOLUTE_TTL_S + 1),
    )
