"""Analysis modules (the spokes): ParsedSession → JSON metric payloads.

Each module lives in its own file and exposes:
    METRIC_KEY: str          — the session_metrics.metric_key it writes
    compute(session: ParsedSession) -> dict   — JSON-serializable payload

Modules are pure functions over the parser output contract. They never touch
the binary, the DB, or HTTP. Honesty rules apply to every payload:
observations not verdicts; missing ≠ zero; negative results are findings;
self-comparison framing (limits come from the driver's own data).

compute_all() never lets one failing module poison the rest: a module error
is recorded as an explicit error payload, not silently dropped.
"""

from __future__ import annotations

from typing import Callable

from proctor_parser.session import ParsedSession

# Populated as modules land; each entry wired here explicitly, no magic.
_MODULES: dict[str, Callable[[ParsedSession], dict]] = {}


def _register(module) -> None:
    _MODULES[module.METRIC_KEY] = module.compute


def compute_all(session: ParsedSession) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for key, fn in _MODULES.items():
        try:
            out[key] = fn(session)
        except Exception as exc:  # noqa: BLE001 — one module must not sink the rest
            out[key] = {
                "error": f"{type(exc).__name__}: {exc}",
                "note": "module failed on this session; nothing was fabricated",
            }
    return out
