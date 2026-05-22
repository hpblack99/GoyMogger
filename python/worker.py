"""
FFE + FreshX Reefer LTL Quote Worker
=====================================
Polls Supabase for pending jobs and hands them to MasterQuoter,
which runs both carriers and returns collated per-row results.

Usage:
  python worker.py

Config via .env:
  SUPABASE_URL, SUPABASE_SERVICE_KEY
  FFE_USERNAME, FFE_PASSWORD
  FRESHX_USERNAME, FRESHX_PASSWORD  ← leave blank to skip FreshX
  DEBUG=true                        ← visible browser windows
"""

import os
import sys
import time
import signal
import threading
import traceback
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from master_quoter import MasterQuoter

load_dotenv()

SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"]
FFE_USERNAME    = os.environ["FFE_USERNAME"]
FFE_PASSWORD    = os.environ["FFE_PASSWORD"]
FRESHX_USERNAME = os.environ.get("FRESHX_USERNAME", "")
FRESHX_PASSWORD = os.environ.get("FRESHX_PASSWORD", "")
DEBUG           = os.environ.get("DEBUG", "").lower() == "true"
POLL_INTERVAL   = int(os.environ.get("POLL_INTERVAL", "5"))

# ── Graceful shutdown ─────────────────────────────────────────────────────────
_shutdown = False

def _handle_signal(*_):
    global _shutdown
    print("\n[Worker] Shutting down after current job…")
    _shutdown = True

signal.signal(signal.SIGINT,  _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def write_row_result(sb: Client, row_id: str, result: dict, error: str | None) -> None:
    """Persist the fully collated result (both carriers + winner) to Supabase."""
    has_rate = bool(result.get("rate") or result.get("freshx_rate"))
    status   = "complete" if has_rate else "error"
    err_msg  = error if not has_rate else (error if error else None)

    payload: dict = {
        "status":          status,
        "rate":            result.get("rate"),
        "transit_days":    result.get("transit_days"),
        "quote_number":    result.get("quote_number"),
        "freshx_rate":     result.get("freshx_rate"),
        "freshx_carrier":  result.get("freshx_carrier"),
        "winning_rate":    result.get("winning_rate"),
        "winning_carrier": result.get("winning_carrier"),
        "winning_source":  result.get("winning_source"),
        "error":           err_msg,
        "updated_at":      _now(),
    }

    try:
        sb.table("quote_rows").update(payload).eq("id", row_id).execute()
    except Exception as e:
        # Fallback for databases that haven't had the FreshX migration applied yet
        if "freshx" in str(e).lower() or "winning" in str(e).lower():
            core = {k: v for k, v in payload.items()
                    if k not in ("freshx_rate", "freshx_carrier",
                                 "winning_rate", "winning_carrier", "winning_source")}
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


def requeue_job(sb: Client, job_id: str, done_rows: int) -> None:
    """Reset non-complete rows to pending; preserve freshx data so FreshX isn't re-run."""
    sb.table("quote_rows").update({
        "status": "pending", "rate": None, "transit_days": None,
        "quote_number": None, "error": None,
        "winning_rate": None, "winning_carrier": None, "winning_source": None,
        "updated_at": _now(),
    }).eq("job_id", job_id).neq("status", "complete").execute()
    sb.table("quote_jobs").update({
        "status": "pending", "done_rows": done_rows, "error": None, "updated_at": _now(),
    }).eq("id", job_id).execute()


_NETWORK_ERROR_PATTERNS = [
    "WinError 10054", "WinError 10053",
    "ConnectionResetError", "connection was forcibly closed",
    "Connection reset by peer", "RemoteDisconnected",
    "BrokenPipeError", "ConnectionAbortedError", "errno 104",
]

def _is_network_error(error: str) -> bool:
    return any(p.lower() in error.lower() for p in _NETWORK_ERROR_PATTERNS)


# ── Job processor ─────────────────────────────────────────────────────────────

def process_job(sb: Client, job: dict) -> None:
    job_id = job["id"]
    print(f"\n[Worker] ── Job {job_id} ──")

    rows = fetch_rows(sb, job_id)
    if not rows:
        print("[Worker] No pending rows — skipping.")
        finish_job(sb, job_id, 0)
        return

    print(f"[Worker] {len(rows)} pending rows | debug={DEBUG}")

    done = job.get("done_rows", 0)

    def on_row_start(row_id: str) -> None:
        mark_row_processing(sb, row_id)

    def on_row_done(row_id: str, result: dict, error: str | None) -> None:
        nonlocal done
        write_row_result(sb, row_id, result, error)
        done += 1
        sb.table("quote_jobs").update({
            "done_rows": done, "updated_at": _now(),
        }).eq("id", job_id).execute()

    try:
        # Run MasterQuoter in a plain thread so Playwright's sync API is not
        # called from inside the asyncio event loop that supabase-py creates.
        _exc: list[BaseException] = []

        # Normalize fields that Supabase may return as JSON booleans or nulls
        raw_acc = job.get("accessorials")
        if isinstance(raw_acc, list):
            accessorials = [str(a) for a in raw_acc if isinstance(a, str)]
        else:
            accessorials = []

        raw_stackable = job.get("is_stackable", False)
        if isinstance(raw_stackable, str):
            is_stackable = raw_stackable.strip().lower() in ("true", "1", "yes")
        else:
            is_stackable = bool(raw_stackable)

        def _run():
            try:
                MasterQuoter(debug=DEBUG).run(
                    rows            = rows,
                    ffe_username    = FFE_USERNAME,
                    ffe_password    = FFE_PASSWORD,
                    freshx_username = FRESHX_USERNAME,
                    freshx_password = FRESHX_PASSWORD,
                    temperature     = job.get("temperature") or "",
                    commodity       = job.get("commodity") or "",
                    is_stackable    = is_stackable,
                    accessorials    = accessorials,
                    on_row_start    = on_row_start,
                    on_row_done     = on_row_done,
                )
            except BaseException as e:
                _exc.append(e)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join()

        if _exc:
            raise _exc[0]

        finish_job(sb, job_id, done)
        print(f"[Worker] Job complete. {done}/{len(rows)} rows processed.")

    except Exception as exc:
        err = str(exc)
        print(f"[Worker] FAILED: {err}")
        traceback.print_exc()
        if _is_network_error(err):
            print("[Worker] Network error — waiting 15s then re-queuing…")
            time.sleep(15)
            requeue_job(sb, job_id, done)
            print(f"[Worker] Re-queued. {done} rows already complete are preserved.")
        else:
            finish_job(sb, job_id, done, error=err)


# ── Main loop ─────────────────────────────────────────────────────────────────

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
