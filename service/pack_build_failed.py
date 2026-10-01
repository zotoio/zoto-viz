"""#253: the pack's code didn't build while it was being checked (UX Pro 2026-10-01).

The check did run, and the pack just didn't build (an esbuild error), so this is neither a block
("<Name> was blocked because …", service/pack_block_copy.py) nor a check that couldn't run ("Couldn't
safety-check …", #111 / #186). It never says "blocked" and never suggests pack lint:

    fresh install: the setup copy table's ``build_failed.install``
    update:        its ``build_failed.upgrade``, ending with the table's ``still`` / ``still_unknown``
                   sentence (web/scripts/pack-install-lint-setup-copy.json)

The raw esbuild error (with its staging paths) is for the log only, never the user text. Callers branch
on :data:`REASON_PACK_BUILD_FAILED` (``reason_code`` on :class:`PackBuildFailedError`, ``reasonCode`` on
the payload / catalog row), never on these words.
"""
from __future__ import annotations

from .pack_install_lint import SETUP_COPY, still_sentence

#: #253: carried as ``reasonCode`` next to the row's ``error`` category (``pack_install_blocked``).
REASON_PACK_BUILD_FAILED = "pack_build_failed"

# The words live in the shared copy table (web/scripts/pack-install-lint-setup-copy.json ``build_failed``).
BUILD_FAILED_INSTALL = str(SETUP_COPY["build_failed"]["install"])
BUILD_FAILED_UPGRADE = str(SETUP_COPY["build_failed"]["upgrade"])


def _label(name: str | None) -> str:
    return str(name or "").strip() or "Plugin"


def build_failed_message(name: str | None) -> str:
    return BUILD_FAILED_INSTALL.format(name=_label(name))


def build_failed_upgrade_message(name: str | None, old_version: str | int | None) -> str:
    old = str(old_version).strip() if old_version is not None else ""
    return BUILD_FAILED_UPGRADE.format(name=_label(name), still=still_sentence(old or None))


def build_failed_payload(message: str) -> dict[str, str]:
    """The fresh-install payload fields (the update path adds ``upgrade_blocked`` / ``zip``)."""
    return {"error": "pack_install_blocked", "message": message, "reasonCode": REASON_PACK_BUILD_FAILED}


class PackBuildFailedError(ValueError):
    """The pack's code didn't build during the install check; ``str(e)`` is the fresh-install user text.

    ``detail`` is the raw build output, for the log only."""

    reason_code = REASON_PACK_BUILD_FAILED

    def __init__(self, name: str | None, *, detail: str = "") -> None:
        self.pack_name = _label(name)
        self.detail = str(detail or "")
        super().__init__(build_failed_message(self.pack_name))
