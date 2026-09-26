"""Pack install retry machine codes stay aligned between Python and web copy."""
from __future__ import annotations

import re
from pathlib import Path

from service.pack_install_retry import PACK_INSTALL_RETRY_RESULTS


def test_pack_install_retry_results_match_web_copy() -> None:
    repo = Path(__file__).resolve().parents[1]
    ts = (repo / "web" / "src" / "plugins" / "pack-install-retry-copy.ts").read_text(encoding="utf-8")
    match = re.search(
        r"export const PACK_INSTALL_RETRY_RESULTS = \[(.*?)\] as const;",
        ts,
        re.DOTALL,
    )
    assert match, "PACK_INSTALL_RETRY_RESULTS missing in pack-install-retry-copy.ts"
    web_codes = re.findall(r'"([^"]+)"', match.group(1))
    assert tuple(web_codes) == PACK_INSTALL_RETRY_RESULTS
