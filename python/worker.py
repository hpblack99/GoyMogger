"""
FFE + FreshX Reefer LTL Quote Worker
=====================================
Polls Supabase for pending quote jobs, runs both carrier automations,
writes results row-by-row, and determines the winning (lowest) rate.

Execution order per job:
  1. FreshX bulk upload (all lanes at once, fast) → stores freshx_rate per row
  2. FFE row-by-row automation → after each row, compares vs FreshX, writes winner

Usage:
  python worker.py

Config via .env:
  SUPABASE_URL, SUPABASE_SERVICE_KEY
  FFE_USERNAME, FFE_PASSWORD
  FRESHX_USERNAME, FRESHX_PASSWORD  ← leave blank to skip FreshX
  DEBUG=true                        ← visible browser windows
"""

import os
import re
import sys
import time
import signal
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from quoter import FFEQuoter
from freshx_quoter import FreshXQuoter

load_dotenv()

SUPABASE_URL      = os.environ["SUPABASE_URL"]
SUPABASE_KEY      = os.environ["SUPABASE_SERVICE_KEY"]
FFE_USERNAME      = os.environ["FFE_USERNAME"]
FFE_PASSWORD      = os.environ["FFE_PASSWORD"]
FRESHX_USERNAME   = os.environ.get("FRESHX_USERNAME", "")
FRESHX_PASSWORD   = os.environ.get("FRESHX_PASSWORD", "")
DEBUG             = os.environ.get("DEBUG", "").lower() == "true"
POLL_INTERVAL     = int(os.environ.get("POLL_INTERVAL", "5"))

# ─── Graceful shutdown ────────────────────────────────────────────────────────
_shutdown = False

def _handle_signal(*_):
    global _shutdown
    print("\n[Worker] Shutting down after current job…")
    _shutdown = True

signal.signal(signal.SIGINT,  _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)

# ─── Supabase helpers ─────────────────────────────────────────────────────────

def claim_job(sb: Client) -> dict | None:
    result = (
        sb.table("quote_jobs")
        .select("*")
        .eq("status", "pending")
        .order("created_at")
        .limit(1)
        .execute()
    )
    if not result.data:
        return None
    job = result.data[0]
    sb.table("quote_jobs").update({
        "status": "running", "updated_at": _now(),
    }).eq("id", job["id"]).execute()
    return job


def fetch_rows(sb: Client, job_id: str) -> list[dict]:
    result = (
        sb.table("quote_rows")
        .select("*")
        .eq("job_id", job_id)
        .in_("status", ["pending", "processing"])
        .order("row_index")
        .execute()
    )
    return result.data or []


def mark_row_processing(sb: Client, row_id: str) -> None:
    sb.table("quote_rows").update({
        "status": "processing", "updated_at": _now(),
    }).eq("id", row_id).execute()


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


def update_row_result(
    sb: Client,
    row_id: str,
    result: dict,
    error: str | None,
    freshx_data: dict | None = None,
) -> None:
    ffe_rate       = result.get("rate") if not error else None
    freshx_rate    = (freshx_data or {}).get("freshx_rate")
    freshx_carrier = (freshx_data or {}).get("freshx_carrier")

    ffe_val    = _parse_rate_val(ffe_rate)
    freshx_val = _parse_rate_val(freshx_rate)

    # Winner = lowest available rate
    if ffe_val is not None and freshx_val is not None:
        if ffe_val <= freshx_val:
            winning_rate, winning_carrier, winning_source = ffe_rate, "FFE Transport", "FFE"
        else:
            winning_rate, winning_carrier, winning_source = freshx_rate, freshx_carrier or "FreshX", "FreshX"
    elif ffe_val is not None:
        winning_rate, winning_carrier, winning_source = ffe_rate, "FFE Transport", "FFE"
    elif freshx_val is not None:
        winning_rate, winning_carrier, winning_source = freshx_rate, freshx_carrier or "FreshX", "FreshX"
    else:
        winning_rate = winning_carrier = winning_source = None

    # Row is complete if either carrier returned a rate
    status  = "complete" if (ffe_rate or freshx_rate) else "error"
    err_msg = error if status == "error" else (error if error else None)

    payload: dict = {
        "status":          status,
        "rate":            ffe_rate,
        "transit_days":    result.get("transit_days"),
        "quote_number":    result.get("quote_number"),
        "error":           err_msg,
        "winning_rate":    winning_rate,
        "winning_carrier": winning_carrier,
        "winning_source":  winning_source,
        "updated_at":      _now(),
    }
    # Include FreshX fields (may be None if FreshX didn't run)
    if freshx_data is not None:
        payload["freshx_rate"]    = freshx_rate
        payload["freshx_carrier"] = freshx_carrier

    try:
        sb.table("quote_rows").update(payload).eq("id", row_id).execute()
    except Exception as e:
        # If new columns don't exist yet, retry with only the core fields
        if "freshx" in str(e).lower() or "winning" in str(e).lower():
            core = {k: v for k, v in payload.items()
                    if k not in ("freshx_rate","freshx_carrier","winning_rate","winning_carrier","winning_source")}
            sb.table("quote_rows").update(core).eq("id", row_id).execute()
        else:
            raise


def finish_job(sb: Client, job_id: str, done_rows: int, error: str | None = None) -> None:
    sb.table("quote_jobs").update({
        "status":    "error" if error else "complete",
        "done_rows": done_rows,
        "error":     error,
        "updated_at": _now(),
    }).eq("id", job_id).execute()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Network error detection ──────────────────────────────────────────────────

_NETWORK_ERROR_PATTERNS = [
    "WinError 10054", "WinError 10053",
    "ConnectionResetError", "connection was forcibly closed",
    "Connection reset by peer", "RemoteDisconnected",
    "BrokenPipeError", "ConnectionAbortedError", "errno 104",
]

def _is_network_error(error: str) -> bool:
    return any(p.lower() in error.lower() for p in _NETWORK_ERROR_PATTERNS)


def requeue_job(sb: Client, job_id: str, done_rows: int) -> None:
    """Reset non-complete rows to pending; preserve freshx data so FreshX isn't re-run redundantly."""
    sb.table("quote_rows").update({
        "status": "pending", "rate": None, "transit_days": None,
        "quote_number": None, "error": None,
        "winning_rate": None, "winning_carrier": None, "winning_source": None,
        "updated_at": _now(),
    }).eq("job_id", job_id).neq("status", "complete").execute()
    sb.table("quote_jobs").update({
        "status": "pending", "done_rows": done_rows, "error": None, "updated_at": _now(),
    }).eq("id", job_id).execute()


# ─── Job processor ────────────────────────────────────────────────────────────

def process_job(sb: Client, job: dict) -> None:
    job_id = job["id"]
    print(f"\n[Worker] ── Job {job_id} ──")

    rows = fetch_rows(sb, job_id)
    if not rows:
        print("[Worker] No pending rows — skipping.")
        finish_job(sb, job_id, 0)
        return

    temperature  = job.get("temperature") or ""
    commodity    = job.get("commodity") or ""
    is_stackable = bool(job.get("is_stackable", False))
    accessorials = job.get("accessorials") or []

    print(f"[Worker] {len(rows)} pending rows | debug={DEBUG}")
    print(f"[Worker] FreshX fields: temp={temperature or '—'}, commodity={commodity or '—'}, stackable={is_stackable}")

    done = job.get("done_rows", 0)

    # ── Step 1: FreshX bulk quote ────────────────────────────────────────────
    freshx_results: dict[int, dict] = {}
    can_freshx = bool(FRESHX_USERNAME and FRESHX_PASSWORD and temperature and commodity)

    if can_freshx:
        print(f"[Worker] ── FreshX bulk quote ({len(rows)} lanes) ──")
        try:
            with FreshXQuoter(debug=DEBUG) as fq:
                freshx_results = fq.run_bulk_quote(
                    rows, FRESHX_USERNAME, FRESHX_PASSWORD,
                    temperature, commodity, is_stackable,
                )

            # Store FreshX results on rows (don't change status — FFE hasn't run yet)
            for row in rows:
                ri = row["row_index"]
                fx = freshx_results.get(ri)
                if fx:
                    try:
                        sb.table("quote_rows").update({
                            "freshx_rate":    fx.get("freshx_rate"),
                            "freshx_carrier": fx.get("freshx_carrier"),
                            "updated_at":     _now(),
                        }).eq("id", row["id"]).execute()
                    except Exception:
                        pass  # Column may not exist yet; worker will include in final update

            got = len([r for r in freshx_results.values() if r.get("freshx_rate")])
            print(f"[Worker] FreshX: {got}/{len(rows)} rates obtained.")

        except Exception as e:
            print(f"[Worker] FreshX FAILED: {e}")
            print("[Worker] Continuing with FFE only.")
    else:
        reasons = []
        if not FRESHX_USERNAME: reasons.append("FRESHX_USERNAME not set")
        if not temperature:     reasons.append("temperature not selected")
        if not commodity:       reasons.append("commodity not selected")
        print(f"[Worker] Skipping FreshX ({'; '.join(reasons) or 'no credentials'}).")

    # ── Step 2: FFE row-by-row ────────────────────────────────────────────────
    print(f"[Worker] ── FFE row-by-row ({len(rows)} lanes) ──")

    row_id_to_index = {r["id"]: r["row_index"] for r in rows}

    def on_row_done(row_id: str, result: dict, error: str | None) -> None:
        nonlocal done
        row_index = row_id_to_index.get(row_id, -1)
        fx_data   = freshx_results.get(row_index)
        update_row_result(sb, row_id, result, error, freshx_data=fx_data)
        done += 1
        sb.table("quote_jobs").update({
            "done_rows": done, "updated_at": _now(),
        }).eq("id", job_id).execute()

        fx_rate = (fx_data or {}).get("freshx_rate", "—")
        icon    = "✓" if (not error and result.get("rate")) or fx_rate not in (None, "—") else "✗"
        print(
            f"  [{done}/{len(rows)}] {icon}  "
            f"ffe={result.get('rate', error or '—')}  "
            f"freshx={fx_rate}"
        )

    try:
        with FFEQuoter(debug=DEBUG) as quoter:
            original_get_quote = quoter.get_quote

            def get_quote_with_signal(row):
                mark_row_processing(sb, row["id"])
                return original_get_quote(row)

            quoter.get_quote = get_quote_with_signal
            quoter.process_job(rows, FFE_USERNAME, FFE_PASSWORD, on_row_done,
                               accessorials=accessorials)

        finish_job(sb, job_id, done)
        print(f"[Worker] Job complete. {done}/{len(rows)} rows processed.")

    except Exception as exc:
        err = str(exc)
        print(f"[Worker] FFE FAILED: {err}")
        if _is_network_error(err):
            print("[Worker] Network error — waiting 15s then re-queuing…")
            time.sleep(15)
            requeue_job(sb, job_id, done)
            print(f"[Worker] Re-queued. {done} rows already complete are preserved.")
        else:
            finish_job(sb, job_id, done, error=err)


# ─── Main loop ────────────────────────────────────────────────────────────────

def main() -> None:
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    freshx_status = "✓ credentials set" if (FRESHX_USERNAME and FRESHX_PASSWORD) else "✗ not configured (FFE-only mode)"
    print("╔══════════════════════════════════════════════════════╗")
    print("║  FFE + FreshX Reefer LTL Quote Worker — ready       ║")
    print(f"║  FreshX: {freshx_status:<44}║")
    print(f"║  Polling every {POLL_INTERVAL}s for pending jobs…              ║")
    print("║  Ctrl+C to stop gracefully                          ║")
    print("╚══════════════════════════════════════════════════════╝\n")

    while not _shutdown:
        try:
            job = claim_job(sb)
            if job:
                process_job(sb, job)
            else:
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print(f"[Worker] Unexpected error: {exc}")
            time.sleep(POLL_INTERVAL)

    print("[Worker] Stopped.")
    sys.exit(0)


if __name__ == "__main__":
    main()
