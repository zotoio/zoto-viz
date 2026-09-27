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


def test_parse_rejects_frame_id_not_matching_uuid_regex() -> None:
    """Token prefix must match UUID frame-id grammar before HMAC verify."""
    junk = "not-a-uuid-frame-id." + mint("demo-pack", SESSION).split(".", 1)[1]
    assert pack_asset_tokens.parse_pack_asset_token(junk) is None
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET, "demo-pack", junk, session_id=SESSION, frame_live=True,
    )


def test_verify_rejects_non_ascii_pack_id() -> None:
    bad_id = "dem\u00f6-pack"
    tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, bad_id, DEFAULT_FRAME)
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET, bad_id, tok, session_id=SESSION, frame_live=True,
    )


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
        frame_live=reg.is_live(SESSION, frame, now=t0 + 86_400 - 1),
    )
    assert not pack_asset_tokens.verify_pack_asset_token(
        SECRET,
        "demo-pack",
        tok,
        session_id=SESSION,
        frame_live=reg.is_live(SESSION, frame, now=t0 + 86_400 + 1),
    )
