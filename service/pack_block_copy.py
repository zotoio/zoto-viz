"""One shape for every user-facing pack block message (#185, UX Pro 2026-09-30).

    fresh install: "<Name> was blocked because <sentence> Nothing was installed, and your wall is
                    unchanged. If you made this pack, run pack lint to see what to fix."
    upgrade:       "<Name> was blocked because <sentence> Nothing was updated, so version <old> is
                    still installed. If you made this pack, run pack lint to see what to fix."

#171 (b), UX Pro 2026-10-01: a block whose only findings are graphics code that would stop the pack
drawing (install lint reason ``graphics_code_error``) keeps that head on an upgrade too, ends with
"Ask its author for a fixed version." and says which version is still there:

    fresh install: "<Name> was blocked because its graphics code has an error that would stop it
                    drawing. Nothing was installed, and your wall is unchanged. Ask its author for a
                    fixed version."
    upgrade:       "… Nothing was installed, and your wall is unchanged. <still> Ask its author for a
                    fixed version." (<still>: the setup copy table's ``still`` / ``still_unknown``
                    sentence, web/scripts/pack-install-lint-setup-copy.json, via pack_install_lint)

<sentence> is plain words ("it tries to reach outside its sandbox."; see PACK_LINT_PLAIN_SUMMARY in
plugins/sdk/pack-lint-hints.ts). No file paths, import specifiers, rule ids or repo/README paths in
user text; those go to ``details`` and the log. Every block keeps the words "was blocked" (callers
branch on them); the setup refusal ("Couldn't safety-check …") never contains them.
"""
from __future__ import annotations

from typing import Iterable

from .pack_install_lint import still_sentence

BLOCK_INSTALL = "{name} was blocked because {sentence} Nothing was installed, and your wall is unchanged."
BLOCK_UPGRADE = "{name} was blocked because {sentence} Nothing was updated, so version {old} is still installed."
BLOCK_UPGRADE_OLD_UNKNOWN = (
    "{name} was blocked because {sentence} Nothing was updated, so the version you had is still installed."
)
BLOCK_FIX_TAIL = "If you made this pack, run pack lint to see what to fix."

# #171 (b): the install lint's block reason for graphics code that would stop the pack drawing
# (plugins/sdk/pack-install-lint.ts GRAPHICS_CODE_ERROR), and its copy.
GRAPHICS_CODE_ERROR = "graphics_code_error"
BLOCK_AUTHOR_TAIL = "Ask its author for a fixed version."

SENTENCE_BOUNDARY = "it loads code from outside its own folder."
SENTENCE_SDK_OLDER = "it was built for an older version of zoto-viz. Its author needs to update it."
SENTENCE_CHECKS_FAILED = "it didn't pass the pack checks."

# Where pack authors read about pack lint (details / log only, never user text).
PACK_LINT_README = "plugins/sdk/starter/README.md#2-pack-lint"


def plain_sentence(sentence: str | None) -> str:
    """Lowercase first letter, ends with a period (the table sentences already are)."""
    text = " ".join(str(sentence or "").split()) or SENTENCE_CHECKS_FAILED
    text = text[0].lower() + text[1:]
    return text if text.endswith((".", "!", "?")) else text + "."


def _label(name: str | None) -> str:
    return str(name or "").strip() or "Plugin"


def _join(head: str, tail: str) -> str:
    return f"{head} {tail}".strip() if tail else head


def block_message(name: str | None, sentence: str | None, *, tail: str = BLOCK_FIX_TAIL) -> str:
    return _join(BLOCK_INSTALL.format(name=_label(name), sentence=plain_sentence(sentence)), tail)


def upgrade_block_message(
    name: str | None,
    sentence: str | None,
    old_version: str | int | None,
    *,
    tail: str = BLOCK_FIX_TAIL,
    reason: str = "",
) -> str:
    old = str(old_version).strip() if old_version is not None else ""
    if reason == GRAPHICS_CODE_ERROR:
        # #171 (b) UX Pro: the fresh-install head, then which version is still there.
        head = BLOCK_INSTALL.format(name=_label(name), sentence=plain_sentence(sentence))
        return _join(f"{head} {still_sentence(old or None)}", tail)
    if old:
        head = BLOCK_UPGRADE.format(name=_label(name), sentence=plain_sentence(sentence), old=old)
    else:
        head = BLOCK_UPGRADE_OLD_UNKNOWN.format(name=_label(name), sentence=plain_sentence(sentence))
    return _join(head, tail)


class PackBlockedError(ValueError):
    """A pack check blocked the install; ``str(e)`` is the fresh-install user text.

    Upgrades re-word it with :func:`upgrade_block_message` from ``sentence`` / ``tail`` / ``reason``.
    ``details`` are diagnostics (file:line findings, the README link) for the log only. ``reason`` is
    the install lint's block reason when it shapes the copy (#171 (b) ``GRAPHICS_CODE_ERROR``)."""

    def __init__(
        self,
        name: str | None,
        sentence: str | None,
        *,
        tail: str = BLOCK_FIX_TAIL,
        details: Iterable[str] = (),
        reason: str = "",
    ) -> None:
        self.pack_name = _label(name)
        self.sentence = plain_sentence(sentence)
        self.tail = tail
        self.reason = reason
        self.details = [str(d) for d in details]
        super().__init__(block_message(self.pack_name, self.sentence, tail=tail))
