"""Retry blocked zip install: machine codes + user-facing copy (keep in sync with web retry copy)."""
from __future__ import annotations

RETRY_RESULT_SUCCESS = "success"
RETRY_RESULT_START_FAILED = "start_failed"
RETRY_RESULT_ZIP_CHANGED = "zip_changed"
RETRY_RESULT_IN_PROGRESS = "in_progress"
RETRY_RESULT_NOT_BLOCKED = "not_blocked"

PACK_INSTALL_RETRY_RESULTS: tuple[str, ...] = (
    RETRY_RESULT_SUCCESS,
    RETRY_RESULT_START_FAILED,
    RETRY_RESULT_ZIP_CHANGED,
    RETRY_RESULT_IN_PROGRESS,
    RETRY_RESULT_NOT_BLOCKED,
)


def pack_label(name: str | None, pack_id: str | None = None) -> str:
    label = (name or pack_id or "Plugin").strip()
    return label or "Plugin"


def format_retry_start_failed_message(
    name: str | None, version: str | int | None, old_version: str | int | None = None
) -> str:
    """#111: Retry ran the install again and the new version failed to start again (the shared copy table,
    web/scripts/pack-install-lint-setup-copy.json ``updates.retry_couldnt_start``; the web reads it too)."""
    from .pack_install_lint import format_update_copy

    return format_update_copy("retry_couldnt_start", pack_label(name), version, old_version)


def format_retry_zip_changed_message(name: str | None, pack_id: str | None = None) -> str:
    label = pack_label(name, pack_id)
    return f"{label} has changed since it was blocked. It'll be checked again on the next scan."


def format_retry_success_history_message(name: str | None, version: str | int | None = 2) -> str:
    label = pack_label(name)
    ver = str(version).strip() if version is not None and str(version).strip() else "2"
    return f"{label} v{ver} installed"


def format_unreadable_block_records_notice(count: int) -> str:
    n = int(count)
    if n <= 0:
        return ""
    if n == 1:
        return (
            "1 blocked install record couldn't be read. That pack stays blocked until you use Retry "
            "or remove the damaged file under ~/.zoto-viz/plugins/local/blocks/."
        )
    return (
        f"{n} blocked install records couldn't be read. Those packs stay blocked until you use Retry "
        "or remove the damaged files under ~/.zoto-viz/plugins/local/blocks/."
    )
