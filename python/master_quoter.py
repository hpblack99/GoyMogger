"""
Master quoter — orchestrates FFE + FreshX, collates per-row results, picks winner.

Usage:
    quoter = MasterQuoter(debug=False)
    quoter.run(
        rows            = [...],          # quote_rows dicts from Supabase
        ffe_username    = "...",
        ffe_password    = "...",
        freshx_username = "...",          # leave blank to skip FreshX
        freshx_password = "...",
        temperature     = "CHILLED",      # required for FreshX
        commodity       = "PRODUCE",      # required for FreshX
        is_stackable    = False,
        accessorials    = ["liftgate_d"],  # passed to FFE form
        on_row_start    = lambda row_id: ...,
        on_row_done     = lambda row_id, result, error: ...,
    )

on_row_done receives a fully collated result dict:
    rate, transit_days, quote_number,
    freshx_rate, freshx_carrier,
    winning_rate, winning_carrier, winning_source
"""

import re
from typing import Callable

from quoter import FFEQuoter
from freshx_quoter import FreshXQuoter


# ── Rate helpers ──────────────────────────────────────────────────────────────

def _parse_rate_val(rate_str: str | None) -> float | None:
    """'$1,234.56' → 1234.56, None if unparseable."""
    if not rate_str:
        return None
    m = re.search(r"[\d,]+\.?\d*", rate_str.replace(",", ""))
    if m:
        try:
            return float(m.group().replace(",", ""))
        except ValueError:
            pass
    return None


def _pick_winner(
    ffe_rate: str | None,
    freshx_rate: str | None,
    freshx_carrier: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Return (winning_rate, winning_carrier, winning_source) — lowest rate wins."""
    ffe_val    = _parse_rate_val(ffe_rate)
    freshx_val = _parse_rate_val(freshx_rate)

    if ffe_val is not None and freshx_val is not None:
        if ffe_val <= freshx_val:
            return ffe_rate, "FFE Transport", "FFE"
        else:
            return freshx_rate, freshx_carrier or "FreshX", "FreshX"
    elif ffe_val is not None:
        return ffe_rate, "FFE Transport", "FFE"
    elif freshx_val is not None:
        return freshx_rate, freshx_carrier or "FreshX", "FreshX"
    else:
        return None, None, None


# ── Master controller ─────────────────────────────────────────────────────────

class MasterQuoter:
    def __init__(self, debug: bool = False):
        self.debug = debug

    def run(
        self,
        rows: list[dict],
        ffe_username: str,
        ffe_password: str,
        freshx_username: str = "",
        freshx_password: str = "",
        temperature: str = "",
        commodity: str = "",
        is_stackable: bool = False,
        accessorials: list[str] | None = None,
        on_row_start: Callable[[str], None] | None = None,
        on_row_done: Callable[[str, dict, str | None], None] | None = None,
    ) -> None:
        """
        Runs FreshX bulk quote (if configured) then FFE row-by-row.
        Calls on_row_start(row_id) before each FFE quote.
        Calls on_row_done(row_id, collated_result, error) after each row.
        """
        # ── Step 1: FreshX bulk ───────────────────────────────────────────────
        freshx_results: dict[int, dict] = {}
        can_freshx = bool(freshx_username and freshx_password and temperature and commodity)

        if can_freshx:
            print(f"[Master] ── FreshX bulk quote ({len(rows)} lanes) ──")
            try:
                with FreshXQuoter(debug=self.debug) as fq:
                    freshx_results = fq.run_bulk_quote(
                        rows, freshx_username, freshx_password,
                        temperature, commodity, is_stackable,
                    )
                got = len([r for r in freshx_results.values() if r.get("freshx_rate")])
                print(f"[Master] FreshX: {got}/{len(rows)} rates obtained.")
            except Exception as e:
                print(f"[Master] FreshX FAILED: {e}")
                print("[Master] Continuing with FFE only.")
        else:
            reasons = []
            if not freshx_username: reasons.append("credentials not set")
            if not temperature:     reasons.append("temperature not selected")
            if not commodity:       reasons.append("commodity not selected")
            print(f"[Master] Skipping FreshX ({'; '.join(reasons) or 'not configured'}).")

        row_id_to_index = {r["id"]: r["row_index"] for r in rows}

        # ── Step 2: FFE row-by-row ────────────────────────────────────────────
        print(f"[Master] ── FFE row-by-row ({len(rows)} lanes) ──")

        def _on_ffe_row_done(row_id: str, ffe_result: dict, ffe_error: str | None) -> None:
            row_index = row_id_to_index.get(row_id, -1)
            fx = freshx_results.get(row_index, {})

            ffe_rate       = ffe_result.get("rate") if not ffe_error else None
            freshx_rate    = fx.get("freshx_rate")
            freshx_carrier = fx.get("freshx_carrier")

            winning_rate, winning_carrier, winning_source = _pick_winner(
                ffe_rate, freshx_rate, freshx_carrier,
            )

            collated = {
                "rate":            ffe_rate,
                "transit_days":    ffe_result.get("transit_days"),
                "quote_number":    ffe_result.get("quote_number"),
                "freshx_rate":     freshx_rate,
                "freshx_carrier":  freshx_carrier,
                "winning_rate":    winning_rate,
                "winning_carrier": winning_carrier,
                "winning_source":  winning_source,
            }

            fx_label = freshx_rate or "—"
            icon = "✓" if winning_rate else "✗"
            print(
                f"  {icon}  ffe={ffe_rate or ffe_error or '—'}  "
                f"freshx={fx_label}  winner={winning_rate or '—'} ({winning_source or '—'})"
            )

            if on_row_done:
                on_row_done(row_id, collated, ffe_error)

        with FFEQuoter(debug=self.debug) as quoter:
            if on_row_start:
                original_get_quote = quoter.get_quote

                def _get_quote_with_start(row: dict) -> dict:
                    on_row_start(row["id"])
                    return original_get_quote(row)

                quoter.get_quote = _get_quote_with_start

            quoter.process_job(
                rows, ffe_username, ffe_password, _on_ffe_row_done,
                accessorials=accessorials,
            )
