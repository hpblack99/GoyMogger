"""
FreshX bulk rate search automation using Playwright.
Uploads a CSV of lanes, waits for results, downloads the quote CSV, returns rates + carriers.

Credentials via .env:
  FRESHX_USERNAME  — account email
  FRESHX_PASSWORD  — account password
"""

import csv
import json
import os
import re
import tempfile
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

CONFIG = json.loads((Path(__file__).parent / "freshx-config.json").read_text())
SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
DOWNLOAD_DIR   = Path(__file__).parent / "downloads"
SCREENSHOT_DIR.mkdir(exist_ok=True)
DOWNLOAD_DIR.mkdir(exist_ok=True)

RESULT_TIMEOUT       = 600   # max seconds to wait for FreshX processing
RESULT_POLL_INTERVAL = 12    # seconds between poll attempts


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _screenshot(page: Page, name: str) -> None:
    try:
        ts = datetime.now().strftime("%H%M%S%f")
        page.screenshot(path=str(SCREENSHOT_DIR / f"freshx-{name}-{ts}.png"), full_page=True)
    except Exception:
        pass


def _try_click(page: Page, selectors: str, timeout: int = 5_000) -> bool:
    """Try each comma-separated selector; click and return True on first match."""
    for sel in [s.strip() for s in selectors.split(",")]:
        try:
            el = page.wait_for_selector(sel, timeout=timeout)
            if el and el.is_visible():
                el.click()
                return True
        except Exception:
            continue
    return False


def _find_col(headers: list[str], candidates: list[str]) -> str | None:
    """Return first candidate that appears in lowercased headers list."""
    for c in candidates:
        if c.lower() in headers:
            return c.lower()
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Quoter class
# ─────────────────────────────────────────────────────────────────────────────

class FreshXQuoter:
    def __init__(self, debug: bool = False):
        self.debug = debug
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    def __enter__(self):
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(
            headless=not self.debug,
            slow_mo=300 if self.debug else 100,
            args=["--start-maximized"],
        )
        self._context = self._browser.new_context(
            no_viewport=True,   # let --start-maximized control the window size
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            accept_downloads=True,
        )
        self._page = self._context.new_page()
        return self

    def __exit__(self, *_):
        for obj in (self._browser, self._playwright):
            try:
                obj and obj.close() if hasattr(obj, "close") else obj and obj.stop()
            except Exception:
                pass
        try:
            if self._playwright:
                self._playwright.stop()
        except Exception:
            pass

    @property
    def page(self) -> Page:
        assert self._page is not None, "FreshXQuoter must be used as context manager"
        return self._page

    # ─── Login ───────────────────────────────────────────────────────────────

    def login(self, email: str, password: str) -> None:
        print("[FreshX] Navigating to login…")
        self.page.goto(CONFIG["urls"]["login"], wait_until="load", timeout=30_000)
        _screenshot(self.page, "01-login")

        cfg = CONFIG["login"]
        # Fill email
        for sel in cfg["email"].split(","):
            try:
                el = self.page.wait_for_selector(sel.strip(), timeout=5_000)
                if el:
                    self.page.fill(sel.strip(), email)
                    break
            except Exception:
                continue

        # Fill password
        for sel in cfg["password"].split(","):
            try:
                el = self.page.wait_for_selector(sel.strip(), timeout=3_000)
                if el:
                    self.page.fill(sel.strip(), password)
                    break
            except Exception:
                continue

        _screenshot(self.page, "02-credentials-filled")
        self.page.click(cfg["submit"])
        self.page.wait_for_load_state("load", timeout=30_000)
        self.page.wait_for_timeout(1_500)
        _screenshot(self.page, "03-after-login")

        url = self.page.url.lower()
        if "login" in url or "signin" in url:
            err_el = self.page.query_selector(cfg["error"])
            msg = (err_el.text_content() or "").strip() or "still on login page"
            raise RuntimeError(f"FreshX login failed: {msg}")

        print(f"[FreshX] Logged in. URL: {self.page.url}")

    # ─── Create upload CSV ────────────────────────────────────────────────────

    def _create_upload_csv(
        self,
        rows: list[dict],
        temperature: str,
        commodity: str,
        is_stackable: bool,
    ) -> str:
        tf = tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, newline="", encoding="utf-8"
        )
        writer = csv.writer(tf)
        writer.writerow([
            "external_id", "from_zip", "to_zip", "pallets",
            "gross_weight", "temperature", "commodity", "is_stackable",
        ])
        for row in rows:
            pallets = row.get("pallets") or 1
            try:
                pallets = max(1, int(pallets))
            except (TypeError, ValueError):
                pallets = 1
            writer.writerow([
                f"ROW_{row['row_index']}",
                str(row["origin_zip"]).zfill(5),
                str(row["dest_zip"]).zfill(5),
                pallets,
                int(float(str(row["weight"]))),
                temperature.upper(),
                commodity.upper().replace(" ", "_"),
                "TRUE" if is_stackable else "FALSE",
            ])
        tf.close()
        return tf.name

    # ─── Main entry point ─────────────────────────────────────────────────────

    def run_bulk_quote(
        self,
        rows: list[dict],
        email: str,
        password: str,
        temperature: str,
        commodity: str,
        is_stackable: bool,
    ) -> dict[int, dict]:
        """
        Upload rows to FreshX bulk search, wait, parse results.
        Returns: { row_index: { 'freshx_rate': str|None, 'freshx_carrier': str|None } }
        """
        self.login(email, password)

        print("[FreshX] Navigating to bulk search page…")
        self.page.goto(CONFIG["urls"]["bulk_search"], wait_until="load", timeout=30_000)
        self.page.wait_for_timeout(1_000)
        self.page.evaluate("window.scrollTo(0, 0)")
        _screenshot(self.page, "04-bulk-search-page")

        pre_count = self._count_history_rows()
        print(f"[FreshX] {pre_count} existing searches in history.")

        csv_path = self._create_upload_csv(rows, temperature, commodity, is_stackable)
        print(f"[FreshX] Upload CSV ready: {csv_path} ({len(rows)} lanes)")

        self._upload_file(csv_path)

        print(f"[FreshX] Waiting for results (up to {RESULT_TIMEOUT}s)…")
        result_row = self._wait_for_result(pre_count, len(rows))
        if result_row is None:
            raise RuntimeError(
                f"FreshX: timed out after {RESULT_TIMEOUT}s waiting for bulk quote results."
            )

        print("[FreshX] Results ready — downloading CSV…")
        results = self._download_results_csv(result_row, len(rows))

        try:
            os.unlink(csv_path)
        except Exception:
            pass

        return results

    # ─── Upload flow ──────────────────────────────────────────────────────────

    def _upload_file(self, csv_path: str) -> None:
        cfg = CONFIG["bulk_search"]

        # Find the "Upload File" button
        upload_btn = None
        for sel in [s.strip() for s in cfg["upload_trigger"].split(",")]:
            try:
                el = self.page.wait_for_selector(sel, timeout=10_000)
                if el and el.is_visible():
                    upload_btn = el
                    break
            except Exception:
                continue

        if upload_btn is None:
            _screenshot(self.page, "05-upload-trigger-missing")
            raise RuntimeError(
                "FreshX: could not find Upload File button. "
                "Update freshx-config.json → bulk_search → upload_trigger."
            )

        # Attempt 1: button opens native file picker — use expect_file_chooser
        try:
            with self.page.expect_file_chooser(timeout=5_000) as fc_info:
                upload_btn.click()
            fc_info.value.set_files(csv_path)
            self.page.wait_for_timeout(1_000)
            _screenshot(self.page, "06-file-set-via-chooser")
        except Exception:
            # Attempt 2: button may reveal a hidden input[type='file']
            self.page.wait_for_timeout(500)
            _screenshot(self.page, "05-upload-opened")
            try:
                file_input = self.page.locator(cfg["file_input"]).first
                file_input.set_input_files(csv_path)
                self.page.wait_for_timeout(600)
                _screenshot(self.page, "06-file-attached")
            except Exception as e:
                _screenshot(self.page, "05-file-input-error")
                raise RuntimeError(f"FreshX: could not set file on input: {e}")

        # After file is set, look for a confirm/submit button (dialog or page)
        for sel in [
            "[role='dialog'] button:has-text('Upload')",
            "[role='dialog'] button[type='submit']",
            "button:has-text('Submit')",
            "button:has-text('Start Search')",
            "button:has-text('Run')",
        ]:
            try:
                btns = self.page.locator(sel).all()
                for btn in btns:
                    if btn.is_visible():
                        btn.click()
                        break
            except Exception:
                continue

        self.page.wait_for_load_state("load", timeout=20_000)
        self.page.wait_for_timeout(1_000)
        _screenshot(self.page, "07-after-upload-submit")

    # ─── Wait for result row ──────────────────────────────────────────────────

    def _count_history_rows(self) -> int:
        try:
            return len(self.page.locator("table tbody tr").all())
        except Exception:
            return 0

    def _wait_for_result(self, pre_count: int, expected_lanes: int) -> object | None:
        deadline = time.time() + RESULT_TIMEOUT
        attempt  = 0

        while time.time() < deadline:
            attempt += 1
            try:
                rows = self.page.locator("table tbody tr").all()
                # Only look at rows that appeared after the upload; if none yet, keep waiting.
                new_rows = rows[:max(0, len(rows) - pre_count)]
                if not new_rows:
                    print(f"[FreshX]   New row not yet in history ({len(rows)} rows currently)…")
                else:
                    for row in new_rows:
                        text = row.inner_text()
                        has_download = False
                        try:
                            dl = row.locator(
                                "button[aria-haspopup='menu'], "
                                "button:has-text('Download'), a:has-text('Download')"
                            ).first
                            has_download = dl.is_visible()
                        except Exception:
                            pass

                        lanes_match = str(expected_lanes) in text
                        if lanes_match and has_download:
                            print(f"[FreshX] Results ready (attempt {attempt}). Row: {text[:80]}")
                            _screenshot(self.page, "09-results-ready")
                            return row

                        if lanes_match:
                            print(f"[FreshX]   Row found but not ready yet: {text[:60]}")

            except Exception as e:
                print(f"[FreshX]   Poll error (attempt {attempt}): {e}")

            remaining = int(deadline - time.time())
            print(f"[FreshX]   Waiting… {remaining}s remaining")
            time.sleep(RESULT_POLL_INTERVAL)

            try:
                self.page.reload(wait_until="load", timeout=20_000)
                self.page.wait_for_timeout(1_000)
                self.page.evaluate("window.scrollTo(0, 0)")
                _screenshot(self.page, f"09-poll-{attempt}")
            except Exception:
                pass

        return None

    # ─── Download + parse ─────────────────────────────────────────────────────

    def _download_results_csv(self, result_row, num_rows: int) -> dict[int, dict]:
        out_path = str(DOWNLOAD_DIR / f"freshx_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv")

        dl_locator = result_row.locator("button[aria-haspopup='menu']").first

        # Scroll to top so the dropdown menu opens within the viewport, not
        # clipped by the bottom edge or obscured by a partially-scrolled page.
        self.page.evaluate("window.scrollTo(0, 0)")
        self.page.wait_for_timeout(300)

        # The Download button always opens a dropdown (never a direct download).
        # Use force=True as fallback to bypass any backdrop overlay left from a
        # previous menu open/close cycle.
        try:
            dl_locator.click(timeout=10_000)
        except Exception:
            dl_locator.click(force=True)

        self.page.wait_for_timeout(800)
        _screenshot(self.page, "10-download-dropdown")

        # Reka UI menu items — "Export CSV" is the exact text from the DOM.
        csv_selectors = [
            "[role='menuitem']:has-text('Export CSV')",
            "[data-reka-collection-item]:has-text('Export CSV')",
            "[role='menuitem']:has-text('CSV')",
            "[data-reka-collection-item]:has-text('CSV')",
            "[role='menuitem']:has-text('Export')",
            "[role='menuitem']",  # last resort: first visible menu item
        ]

        for sel in csv_selectors:
            try:
                els = self.page.locator(sel).all()
                for el in els:
                    try:
                        if el.is_visible(timeout=800):
                            label = el.inner_text().strip()
                            print(f"[FreshX] Clicking menu item: '{label}'")
                            with self.page.expect_download(timeout=30_000) as dl_info:
                                el.click()
                            dl_info.value.save_as(out_path)
                            print(f"[FreshX] Downloaded: {out_path}")
                            return _parse_results_csv(out_path, num_rows)
                    except Exception:
                        continue
            except Exception:
                continue

        _screenshot(self.page, "10-download-failed")
        raise RuntimeError(
            "FreshX: could not trigger CSV download. "
            "Check python/screenshots/10-download-dropdown*.png to see what "
            "the dropdown contains."
        )


# ─────────────────────────────────────────────────────────────────────────────
# CSV parsing
# ─────────────────────────────────────────────────────────────────────────────

def _parse_results_csv(path: str, expected_rows: int) -> dict[int, dict]:
    """
    Parse the FreshX results CSV.
    Multiple rows per lane (one per carrier quote) — keeps the cheapest.
    Returns { row_index: { 'freshx_rate': '$123.45'|None, 'freshx_carrier': 'Name'|None } }
    """
    cfg = CONFIG["results_csv"]
    # _best tracks (rate_as_float, rate_str, carrier) per row_index
    _best: dict[int, tuple[float, str, str | None]] = {}

    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            raw_headers = reader.fieldnames or []
            headers = [h.lower().strip() for h in raw_headers]

            id_col      = _find_col(headers, cfg["id_columns"])
            rate_col    = _find_col(headers, cfg["rate_columns"])
            carrier_col = _find_col(headers, cfg["carrier_columns"])

            print(f"[FreshX] Result CSV headers: {headers}")
            print(f"[FreshX] Mapped: id={id_col}, rate={rate_col}, carrier={carrier_col}")

            for raw_row in reader:
                row = {k.lower().strip(): (v or "").strip() for k, v in raw_row.items()}

                if not id_col:
                    continue
                ext_id = row.get(id_col, "")
                m = re.search(r"ROW_(\d+)", ext_id, re.IGNORECASE)
                if not m:
                    continue
                row_index = int(m.group(1))

                rate_val: float | None = None
                rate_str: str | None = None
                if rate_col:
                    raw_rate = row.get(rate_col, "").replace(",", "").replace("$", "").strip()
                    try:
                        rate_val = float(raw_rate)
                        rate_str = f"${rate_val:,.2f}"
                    except (ValueError, TypeError):
                        pass  # "-" or empty → no quote for this carrier

                carrier = (row.get(carrier_col, "").strip() or None) if carrier_col else None

                if rate_val is None:
                    # Record that we saw this lane even if no rate
                    _best.setdefault(row_index, (float("inf"), None, None))  # type: ignore
                    continue

                existing = _best.get(row_index)
                if existing is None or rate_val < existing[0]:
                    _best[row_index] = (rate_val, rate_str, carrier)

    except Exception as e:
        print(f"[FreshX] Warning: could not parse results CSV ({path}): {e}")

    results: dict[int, dict] = {}
    for idx, (_, rate_str, carrier) in _best.items():
        results[idx] = {"freshx_rate": rate_str, "freshx_carrier": carrier}

    print(f"[FreshX] Parsed {len(results)}/{expected_rows} rows (cheapest per lane).")
    return results
