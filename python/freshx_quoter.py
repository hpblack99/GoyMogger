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

RESULT_TIMEOUT       = 600   # base max seconds to wait for FreshX processing
RESULT_POLL_INTERVAL = 12    # seconds between poll attempts
PER_LANE_SECONDS     = 25    # extra wait budget per lane (big batches take longer)

# Visible browser by default (the operator likes to watch it); HEADLESS=true hides it.
HEADLESS = os.environ.get("HEADLESS", "").lower() == "true"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# Header row written to the bulk-upload CSV. Override in freshx-config.json →
# upload_csv → columns if FreshX changes its template.
DEFAULT_UPLOAD_COLUMNS = [
    "external_id", "from_zip", "to_zip", "pallets",
    "gross_weight", "temperature", "commodity", "is_stackable",
]

# Selectors for a single row in the search-history list. FreshX is a modern SPA
# and may render the list as a real <table> OR a div/grid — we try each. Override
# in freshx-config.json → history_row_selectors.
DEFAULT_HISTORY_ROW_SELECTORS = [
    "table tbody tr",
    "[role='row']",
    "[role='rowgroup'] > div",
    "ul li",
]


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
        # FreshX is a chatty SPA (live websockets/polling) so it NEVER reaches
        # network-idle — waiting for that state just times out and kills the run.
        # Wait for the DOM + a short settle so the post-login redirect resolves.
        self.page.wait_for_load_state("load", timeout=30_000)
        self.page.wait_for_timeout(2_500)
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
        columns = CONFIG.get("upload_csv", {}).get("columns") or DEFAULT_UPLOAD_COLUMNS
        writer.writerow(columns)
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
        self.page.goto(CONFIG["urls"]["bulk_search"], wait_until="domcontentloaded", timeout=30_000)
        self.page.wait_for_timeout(2_500)   # SPA render settle (never network-idle)
        self.page.evaluate("window.scrollTo(0, 0)")
        _screenshot(self.page, "04-bulk-search-page")

        pre_count = self._count_history_rows()
        print(f"[FreshX] {pre_count} existing searches in history.")

        csv_path = self._create_upload_csv(rows, temperature, commodity, is_stackable)
        print(f"[FreshX] Upload CSV ready: {csv_path} ({len(rows)} lanes)")

        self._upload_file(csv_path)

        # Larger batches take FreshX longer to process — scale the deadline.
        timeout = max(RESULT_TIMEOUT, len(rows) * PER_LANE_SECONDS)
        print(f"[FreshX] Waiting for results (up to {timeout}s for {len(rows)} lanes)…")
        result_row = self._wait_for_result(pre_count, len(rows), timeout)
        if result_row is None:
            _screenshot(self.page, "08-result-timeout")
            raise RuntimeError(
                f"FreshX: timed out after {timeout}s waiting for bulk quote results. "
                "See python/screenshots/freshx-08-result-timeout*.png and freshx-09-poll-*.png "
                "to check whether the search-history row/selector changed."
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

        # After the file is set, click exactly ONE confirm/submit button.
        # Some FreshX layouts auto-submit on file select; others need a click.
        # Stop at the first visible match so we never fire two submissions.
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

        self.page.wait_for_timeout(2_000)   # let the search enqueue (no network-idle wait)
        _screenshot(self.page, "07-after-upload-submit")

    # ─── Wait for result row ──────────────────────────────────────────────────

    def _history_rows(self):
        """Return (row_locators, selector_used). FreshX may render the search
        history as a <table>, an ARIA grid, or a div/list — try each until one
        yields rows so a UI refactor doesn't silently break result detection."""
        selectors = CONFIG.get("history_row_selectors") or DEFAULT_HISTORY_ROW_SELECTORS
        for sel in selectors:
            try:
                rows = self.page.locator(sel).all()
                if rows:
                    return rows, sel
            except Exception:
                continue
        return [], None

    def _count_history_rows(self) -> int:
        rows, _ = self._history_rows()
        return len(rows)

    def _row_is_ready(self, row) -> bool:
        """A finished search exposes a Download/Export affordance."""
        try:
            dl = row.locator(
                "button[aria-haspopup='menu'], "
                "button:has-text('Download'), a:has-text('Download'), "
                "button:has-text('Export'), a:has-text('Export')"
            ).first
            return dl.is_visible()
        except Exception:
            return False

    def _wait_for_result(self, pre_count: int, expected_lanes: int,
                         timeout: int = RESULT_TIMEOUT) -> object | None:
        deadline = time.time() + timeout
        attempt  = 0

        while time.time() < deadline:
            attempt += 1
            try:
                rows, sel = self._history_rows()
                # Rows that appeared after our upload (list is newest-first).
                new_rows = rows[:max(0, len(rows) - pre_count)]

                if not rows:
                    print(f"[FreshX]   No history rows visible yet "
                          f"(tried selectors, none matched) — attempt {attempt}")
                elif not new_rows:
                    print(f"[FreshX]   Our search not in history yet "
                          f"({len(rows)} rows via '{sel}')…")
                else:
                    # The newest post-upload row is our search. Prefer a row whose
                    # text mentions our lane count, but fall back to the newest new
                    # row so a formatting change in the count doesn't strand us.
                    target = None
                    for row in new_rows:
                        try:
                            text = row.inner_text()
                        except Exception:
                            text = ""
                        if str(expected_lanes) in text and self._row_is_ready(row):
                            target = row
                            break
                    if target is None:
                        newest = new_rows[0]
                        if self._row_is_ready(newest):
                            target = newest

                    if target is not None:
                        print(f"[FreshX] Results ready (attempt {attempt}, via '{sel}').")
                        _screenshot(self.page, "09-results-ready")
                        return target

                    print(f"[FreshX]   {len(new_rows)} new row(s) found but none "
                          f"downloadable yet…")

            except Exception as e:
                print(f"[FreshX]   Poll error (attempt {attempt}): {e}")

            remaining = int(deadline - time.time())
            print(f"[FreshX]   Waiting… {remaining}s remaining")
            time.sleep(RESULT_POLL_INTERVAL)

            try:
                self.page.reload(wait_until="domcontentloaded", timeout=20_000)
                self.page.wait_for_timeout(1_500)
                self.page.evaluate("window.scrollTo(0, 0)")
                _screenshot(self.page, f"09-poll-{attempt}")
            except Exception:
                pass

        return None

    # ─── Download + parse ─────────────────────────────────────────────────────

    def _download_results_csv(self, result_row, num_rows: int) -> dict[int, dict]:
        out_path = str(DOWNLOAD_DIR / f"freshx_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv")

        # Scroll into view so the menu opens within the viewport.
        try:
            result_row.scroll_into_view_if_needed(timeout=3_000)
        except Exception:
            pass
        self.page.evaluate("window.scrollTo(0, 0)")
        self.page.wait_for_timeout(300)

        # Locate the download/export trigger — a Reka dropdown, or a plain
        # Download/Export button/link if the UI changed.
        dl_locator = result_row.locator(
            "button[aria-haspopup='menu'], "
            "button:has-text('Download'), a:has-text('Download'), "
            "button:has-text('Export'), a:has-text('Export')"
        ).first

        # Some triggers download directly; others open a dropdown. Try to catch a
        # direct download first; if none fires, fall through to menu-item clicking.
        opened_menu = True
        try:
            with self.page.expect_download(timeout=4_000) as dl_info:
                try:
                    dl_locator.click(timeout=10_000)
                except Exception:
                    dl_locator.click(force=True)
            dl_info.value.save_as(out_path)
            print(f"[FreshX] Direct download: {out_path}")
            return _parse_results_csv(out_path, num_rows)
        except Exception:
            opened_menu = True  # no direct download → a dropdown likely opened

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

        if opened_menu:
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
            "Check python/screenshots/freshx-10-download-dropdown*.png to see what "
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
