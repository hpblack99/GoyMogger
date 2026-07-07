"""
FreshX bulk rate search automation using Playwright.
Uploads a CSV of lanes, waits for results, downloads the quote CSV, returns rates + carriers.

Reliability design
------------------
Every upload embeds a unique run tag in each lane's external_id (ROW_<i>_T<tag>).
When polling the search history we don't trust row text or ordering to decide
which row is ours — we download candidate CSVs and verify the tag inside the
file. A CSV without our tag is some older search; we keep waiting. This makes
"scraped the wrong/previous run" failures structurally impossible.

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

RESULT_TIMEOUT       = 600   # base max seconds to wait for FreshX processing
RESULT_POLL_INTERVAL = 12    # seconds between poll attempts
PER_LANE_SECONDS     = 25    # extra wait budget per lane (big batches take longer)
MAX_CANDIDATE_ROWS   = 3     # newest history rows to try downloading each poll

# Visible browser by default; set HEADLESS=true in .env to hide it.
HEADLESS = os.environ.get("HEADLESS", "").lower() == "true"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# Default header row for the bulk-upload CSV. Override in freshx-config.json →
# upload_csv → columns if FreshX changes its template.
DEFAULT_UPLOAD_COLUMNS = [
    "external_id", "from_zip", "to_zip", "pallets",
    "gross_weight", "temperature", "commodity", "is_stackable",
]

# Selectors for a single row in the search-history list, tried in order.
# FreshX may render a real <table>, an ARIA grid, or a div list.
DEFAULT_HISTORY_ROW_SELECTORS = [
    "table tbody tr",
    "[role='row']",
    "[role='rowgroup'] > div",
]

# A finished search exposes some download/export affordance on its row.
DOWNLOAD_TRIGGER = (
    "button[aria-haspopup='menu'], "
    "button:has-text('Download'), a:has-text('Download'), "
    "button:has-text('Export'), a:has-text('Export')"
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _screenshot(page: Page, name: str) -> None:
    try:
        ts = datetime.now().strftime("%H%M%S%f")
        page.screenshot(path=str(SCREENSHOT_DIR / f"freshx-{name}-{ts}.png"), full_page=True)
    except Exception:
        pass


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
    def __init__(self, debug: bool = False, headless: bool | None = None):
        self.debug = debug
        self.headless = HEADLESS if headless is None else headless
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    def __enter__(self):
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(
            headless=self.headless,
            slow_mo=300 if self.debug else 100,
            args=["--start-maximized"],
        )
        self._context = self._browser.new_context(
            no_viewport=True,   # let --start-maximized control the window size
            user_agent=USER_AGENT,
            accept_downloads=True,
        )
        self._page = self._context.new_page()
        return self

    def __exit__(self, *_):
        try:
            if self._browser:
                self._browser.close()
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
        # FreshX is a live SPA — never wait for network-idle (it never comes).
        self.page.wait_for_load_state("load", timeout=30_000)
        self.page.wait_for_timeout(2_000)
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
        run_tag: str,
    ) -> str:
        tf = tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, newline="", encoding="utf-8"
        )
        writer = csv.writer(tf)
        columns = CONFIG.get("upload_csv", {}).get("columns") or DEFAULT_UPLOAD_COLUMNS
        writer.writerow(columns)
        for row in rows:
            pallets = row.get("pallets") or 1
            try:
                pallets = max(1, int(pallets))
            except (TypeError, ValueError):
                pallets = 1
            writer.writerow([
                f"ROW_{row['row_index']}_T{run_tag}",
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
        self.page.wait_for_timeout(1_500)
        self.page.evaluate("window.scrollTo(0, 0)")
        _screenshot(self.page, "04-bulk-search-page")

        run_tag = datetime.now().strftime("%m%d%H%M%S")
        csv_path = self._create_upload_csv(rows, temperature, commodity, is_stackable, run_tag)
        print(f"[FreshX] Upload CSV ready: {csv_path} ({len(rows)} lanes, tag T{run_tag})")

        self._upload_file(csv_path)

        # Larger batches take FreshX longer to process — scale the deadline.
        timeout = max(RESULT_TIMEOUT, len(rows) * PER_LANE_SECONDS)
        print(f"[FreshX] Waiting for results (up to {timeout}s for {len(rows)} lanes)…")
        results = self._wait_and_collect(len(rows), run_tag, timeout)

        try:
            os.unlink(csv_path)
        except Exception:
            pass

        if results is None:
            _screenshot(self.page, "08-result-timeout")
            raise RuntimeError(
                f"FreshX: timed out after {timeout}s waiting for bulk quote results "
                f"(tag T{run_tag}). See python/screenshots/freshx-08-result-timeout*.png "
                "and freshx-09-poll-*.png to see what the history page looked like."
            )
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

        # After the file is set, click exactly ONE confirm/submit button.
        # Some FreshX layouts auto-submit on file select; others need a click.
        confirm_selectors = [
            "[role='dialog'] button:has-text('Upload')",
            "[role='dialog'] button[type='submit']",
            "button:has-text('Submit')",
            "button:has-text('Start Search')",
            "button:has-text('Run')",
        ]
        clicked = False
        for sel in confirm_selectors:
            if clicked:
                break
            try:
                for btn in self.page.locator(sel).all():
                    if btn.is_visible():
                        print(f"[FreshX] Confirming upload via: {sel}")
                        btn.click()
                        clicked = True
                        break
            except Exception:
                continue

        self.page.wait_for_timeout(2_000)   # let the search enqueue
        _screenshot(self.page, "07-after-upload-submit")

    # ─── Wait for results (download-and-verify) ───────────────────────────────

    def _history_rows(self):
        """Return (row_locators, selector_used) for the search-history list."""
        selectors = CONFIG.get("history_row_selectors") or DEFAULT_HISTORY_ROW_SELECTORS
        for sel in selectors:
            try:
                rows = self.page.locator(sel).all()
                if rows:
                    return rows, sel
            except Exception:
                continue
        return [], None

    def _wait_and_collect(
        self, expected_lanes: int, run_tag: str, timeout: int
    ) -> dict[int, dict] | None:
        """Poll the history list; download candidate CSVs and accept the first
        one that contains our run tag. Returns parsed results, or None on timeout."""
        deadline = time.time() + timeout
        attempt  = 0
        # Skip re-downloading a row whose text hasn't changed since it was rejected.
        rejected: set[str] = set()

        while time.time() < deadline:
            attempt += 1
            try:
                rows, sel = self._history_rows()
                if not rows:
                    print(f"[FreshX]   No history rows found yet (attempt {attempt})")
                else:
                    if attempt == 1:
                        print(f"[FreshX]   {len(rows)} history rows via '{sel}'")
                    for row in rows[:MAX_CANDIDATE_ROWS]:
                        try:
                            text = " ".join(row.inner_text().split())[:160]
                        except Exception:
                            text = ""
                        if text in rejected:
                            continue

                        dl = row.locator(DOWNLOAD_TRIGGER).first
                        try:
                            if not dl.is_visible():
                                continue
                        except Exception:
                            continue

                        print(f"[FreshX]   Candidate row: {text[:80]!r} — downloading to verify…")
                        path = self._download_row_csv(row)
                        if not path:
                            continue

                        results = _parse_results_csv(path, expected_lanes, run_tag)
                        if results:
                            print(f"[FreshX] Verified tag T{run_tag} — results accepted "
                                  f"(attempt {attempt}).")
                            _screenshot(self.page, "09-results-ready")
                            return results

                        print(f"[FreshX]   CSV didn't contain tag T{run_tag} "
                              "(older search) — still waiting.")
                        rejected.add(text)

            except Exception as e:
                print(f"[FreshX]   Poll error (attempt {attempt}): {e}")

            remaining = int(deadline - time.time())
            print(f"[FreshX]   Waiting… {remaining}s remaining")
            time.sleep(RESULT_POLL_INTERVAL)

            try:
                self.page.reload(wait_until="load", timeout=20_000)
                self.page.wait_for_timeout(1_500)
                self.page.evaluate("window.scrollTo(0, 0)")
                _screenshot(self.page, f"09-poll-{attempt}")
            except Exception:
                pass

        return None

    # ─── Download one row's CSV ───────────────────────────────────────────────

    def _download_row_csv(self, row) -> str | None:
        """Trigger the download on a history row. Handles both a direct-download
        button and the Reka dropdown → 'Export CSV'. Returns the saved path,
        or None if no download fired."""
        out_path = str(DOWNLOAD_DIR / f"freshx_{datetime.now().strftime('%Y%m%d_%H%M%S%f')}.csv")

        try:
            row.scroll_into_view_if_needed(timeout=3_000)
        except Exception:
            pass
        self.page.wait_for_timeout(200)

        dl = row.locator(DOWNLOAD_TRIGGER).first

        # Try a direct download first; if none fires within a short window,
        # assume a dropdown menu opened instead.
        try:
            with self.page.expect_download(timeout=4_000) as dl_info:
                try:
                    dl.click(timeout=8_000)
                except Exception:
                    dl.click(force=True)
            dl_info.value.save_as(out_path)
            print(f"[FreshX]   Direct download: {out_path}")
            return out_path
        except Exception:
            pass

        self.page.wait_for_timeout(600)
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
                for el in self.page.locator(sel).all():
                    try:
                        if el.is_visible(timeout=800):
                            label = el.inner_text().strip()
                            print(f"[FreshX]   Clicking menu item: '{label}'")
                            with self.page.expect_download(timeout=30_000) as dl_info:
                                el.click()
                            dl_info.value.save_as(out_path)
                            print(f"[FreshX]   Downloaded: {out_path}")
                            return out_path
                    except Exception:
                        continue
            except Exception:
                continue

        # Close any dangling dropdown so it doesn't block the next attempt.
        try:
            self.page.keyboard.press("Escape")
        except Exception:
            pass
        return None


# ─────────────────────────────────────────────────────────────────────────────
# CSV parsing
# ─────────────────────────────────────────────────────────────────────────────

def _parse_results_csv(path: str, expected_rows: int, run_tag: str | None = None) -> dict[int, dict]:
    """
    Parse a FreshX results CSV.
    Multiple rows per lane (one per carrier quote) — keeps the cheapest.
    When run_tag is given, only rows whose external id carries that tag count;
    a CSV from a different run parses to {} so the caller keeps waiting.
    Returns { row_index: { 'freshx_rate': '$123.45'|None, 'freshx_carrier': 'Name'|None } }
    """
    cfg = CONFIG["results_csv"]
    # _best tracks (rate_as_float, rate_str, carrier) per row_index
    _best: dict[int, tuple[float, str | None, str | None]] = {}

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

            if not id_col:
                return {}

            for raw_row in reader:
                row = {k.lower().strip(): (v or "").strip() for k, v in raw_row.items()}

                ext_id = row.get(id_col, "")
                m = re.search(r"ROW_(\d+)", ext_id, re.IGNORECASE)
                if not m:
                    continue
                if run_tag and f"_T{run_tag}".lower() not in ext_id.lower():
                    continue  # a lane from some other run — not ours
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
                    _best.setdefault(row_index, (float("inf"), None, None))
                    continue

                existing = _best.get(row_index)
                if existing is None or rate_val < existing[0]:
                    _best[row_index] = (rate_val, rate_str, carrier)

    except Exception as e:
        print(f"[FreshX] Warning: could not parse results CSV ({path}): {e}")

    results: dict[int, dict] = {}
    for idx, (_, rate_str, carrier) in _best.items():
        results[idx] = {"freshx_rate": rate_str, "freshx_carrier": carrier}

    print(f"[FreshX] Parsed {len(results)}/{expected_rows} lanes (cheapest per lane).")
    return results
