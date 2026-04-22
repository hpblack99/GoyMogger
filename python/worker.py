"""
FFE Reefer LTL Quote Bot — Python Worker
=========================================
Polls Supabase for pending quote jobs, runs the FFE website automation,
and writes results back row-by-row so the React UI updates in real-time.

Usage:
  python worker.py

Config via .env (copy from .env.example):
  SUPABASE_URL
  SUPABASE_SERVICE_KEY   ← use the service role key (bypasses RLS for writes)
  FFE_USERNAME
  FFE_PASSWORD
  DEBUG=true             ← opens a visible browser window
"""

import os
import time
import signal
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from quoter import FFEQuoter

load_dotenv()

SUPABASE_URL        = os.environ["SUPABASE_URL"]
SUPABASE_KEY        = os.environ["SUPABASE_SERVICE_KEY"]
FFE_USERNAME        = os.environ["FFE_USERNAME"]
FFE_PASSWORD        = os.environ["FFE_PASSWORD"]
DEBUG               = os.environ.get("DEBUG", "").lower() == "true"
POLL_INTERVAL       = int(os.environ.get("POLL_INTERVAL", "5"))   # seconds

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
    """Atomically grab the oldest pending job and mark it running."""
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

    # Mark running
    sb.table("quote_jobs").update({
        "status": "running",
        "updated_at": _now(),
    }).eq("id", job["id"]).execute()

    return job


def fetch_rows(sb: Client, job_id: str) -> list[dict]:
    result = (
        sb.table("quote_rows")
        .select("*")
        .eq("job_id", job_id)
        .order("row_index")
        .execute()
    )
    return result.data or []


def mark_row_processing(sb: Client, row_id: str) -> None:
    sb.table("quote_rows").update({
        "status": "processing",
        "updated_at": _now(),
    }).eq("id", row_id).execute()


def update_row_result(sb: Client, row_id: str, result: dict, error: str | None) -> None:
    if error:
        payload = {"status": "error", "error": error, "updated_at": _now()}
    else:
        payload = {
            "status": "complete" if result.get("rate") else "error",
            "rate":         result.get("rate"),
            "transit_days": result.get("transit_days"),
            "quote_number": result.get("quote_number"),
            "error": None if result.get("rate") else "No rate returned — check ffe-selectors.json",
            "updated_at": _now(),
        }
    sb.table("quote_rows").update(payload).eq("id", row_id).execute()


def finish_job(sb: Client, job_id: str, done_rows: int, error: str | None = None) -> None:
    sb.table("quote_jobs").update({
        "status":    "error" if error else "complete",
        "done_rows": done_rows,
        "error":     error,
        "updated_at": _now(),
    }).eq("id", job_id).execute()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Job processor ───────────────────────────────────────────────────────────

def process_job(sb: Client, job: dict) -> None:
    job_id = job["id"]
    print(f"\n[Worker] ── Job {job_id} ──")

    rows = fetch_rows(sb, job_id)
    if not rows:
        print("[Worker] No rows found, skipping.")
        finish_job(sb, job_id, 0)
        return

    print(f"[Worker] {len(rows)} shipment(s) to quote. debug={DEBUG}")
    done = 0

    def on_row_done(row_id: str, result: dict, error: str | None) -> None:
        nonlocal done
        update_row_result(sb, row_id, result, error)
        done += 1
        # Keep job's done_rows counter live so UI progress bar updates
        sb.table("quote_jobs").update({
            "done_rows": done,
            "updated_at": _now(),
        }).eq("id", job_id).execute()
        status_icon = "✓" if not error and result.get("rate") else "✗"
        print(f"  [{done}/{len(rows)}] {status_icon}  row_id={row_id}  rate={result.get('rate', error)}")

    try:
        with FFEQuoter(debug=DEBUG) as quoter:
            # Signal each row as processing right before we quote it
            original_get_quote = quoter.get_quote

            def get_quote_with_signal(row):
                mark_row_processing(sb, row["id"])
                return original_get_quote(row)

            quoter.get_quote = get_quote_with_signal
            quoter.process_job(rows, FFE_USERNAME, FFE_PASSWORD, on_row_done)

        finish_job(sb, job_id, done)
        print(f"[Worker] Job complete. {done}/{len(rows)} rows quoted.")

    except Exception as exc:
        err = str(exc)
        print(f"[Worker] Job FAILED: {err}")
        finish_job(sb, job_id, done, error=err)


# ─── Main loop ────────────────────────────────────────────────────────────────

def main() -> None:
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("╔══════════════════════════════════════════╗")
    print("║  FFE Reefer LTL Quote Worker — ready     ║")
    print(f"║  Polling every {POLL_INTERVAL}s for pending jobs…   ║")
    print("║  Ctrl+C to stop gracefully               ║")
    print("╚══════════════════════════════════════════╝\n")

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
