"""
FFE website automation using Playwright (Python).
Selectors and URLs live in ffe-selectors.json — edit that file when the site changes.
Set DEBUG=true in .env to run with a visible browser. Screenshots saved to python/screenshots/.
"""

import json
import re
import time
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

CONFIG = json.loads((Path(__file__).parent / "ffe-selectors.json").read_text())
SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

# Internal FFE class select IDs, from the live DOM of /Customer/RateRequest
CLASS_ID_MAP: dict[str, str] = CONFIG["class_id_map"]

# Seconds between quotes — be polite to the server
DELAY_BETWEEN_QUOTES = 1.5


def _screenshot(page: Page, name: str) -> None:
    try:
        ts = datetime.now().strftime("%H%M%S%f")
        page.screenshot(path=str(SCREENSHOT_DIR / f"{name}-{ts}.png"), full_page=True)
    except Exception:
        pass


def _resolve_class_id(freight_class: str) -> str:
    """
    Convert a user-supplied freight class (e.g. '100', 'Class 100', '77.5')
    to FFE's internal select option value.
    Raises ValueError if the class is not in the mapping.
    """
    raw = str(freight_class).strip()
    # Strip common prefixes like "Class " or "class"
    cleaned = re.sub(r"(?i)^class\s*", "", raw).strip()
    if cleaned in CLASS_ID_MAP:
        return CLASS_ID_MAP[cleaned]
    # Try rounding .0 suffix (e.g. "100.0" → "100")
    try:
        as_float = float(cleaned)
        rounded = str(int(as_float)) if as_float == int(as_float) else str(as_float)
        if rounded in CLASS_ID_MAP:
            return CLASS_ID_MAP[rounded]
    except ValueError:
        pass
    valid = sorted(CLASS_ID_MAP.keys(), key=float)
    raise ValueError(
        f"Unknown freight class '{freight_class}'. "
        f"Valid classes: {', '.join(valid)}"
    )


def _get_text(page: Page, selector: str) -> str | None:
    """Try each comma-separated selector; return first non-empty text."""
    for sel in [s.strip() for s in selector.split(",")]:
        try:
            el = page.query_selector(sel)
            if el:
                text = el.text_content()
                if text and text.strip():
                    return text.strip()
        except Exception:
            continue
    return None


class FFEQuoter:
    def __init__(self, debug: bool = False):
        self.debug = debug
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    def __enter__(self):
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(
            headless=False,  # TODO: change back to `not self.debug` when done debugging
            slow_mo=300 if self.debug else 0,
        )
        self._context = self._browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        self._page = self._context.new_page()
        return self

    def __exit__(self, *_):
        try:
            self._browser.close()
        except Exception:
            pass
        try:
            self._playwright.stop()
        except Exception:
            pass

    @property
    def page(self) -> Page:
        assert self._page is not None, "FFEQuoter must be used as a context manager"
        return self._page

    # ─────────────────────────────────────────────────────────────────────────
    # Login
    # ─────────────────────────────────────────────────────────────────────────

    def login(self, username: str, password: str) -> None:
        print("[FFE] Navigating to login page…")
        self.page.goto(CONFIG["urls"]["login"], wait_until="load", timeout=30_000)
        _screenshot(self.page, "01-login-page")

        self.page.fill(CONFIG["login"]["username"], username)
        self.page.fill(CONFIG["login"]["password"], password)
        _screenshot(self.page, "02-credentials-filled")

        with self.page.expect_navigation(wait_until="load", timeout=30_000):
            self.page.click(CONFIG["login"]["submit"])

        _screenshot(self.page, "03-after-login")

        error_el = self.page.query_selector(CONFIG["login"]["error"])
        if error_el:
            msg = error_el.text_content() or "invalid credentials"
            raise RuntimeError(f"Login failed: {msg.strip()}")

        if "/Account/Login" in self.page.url:
            raise RuntimeError("Login failed — still on login page. Check username/password.")

        print(f"[FFE] Logged in. URL: {self.page.url}")

    # ─────────────────────────────────────────────────────────────────────────
    # Navigate to rate request page
    # ─────────────────────────────────────────────────────────────────────────

    def navigate_to_rate_request(self) -> None:
        print("[FFE] Navigating to Rate Request…")
        self.page.goto(CONFIG["urls"]["rate_request"], wait_until="load", timeout=30_000)
        _screenshot(self.page, "04-rate-request")

        if "/Account/Login" in self.page.url:
            raise RuntimeError("Redirected to login — session expired.")

        # Verify the form is present
        origin_el = self.page.query_selector(CONFIG["quote_form"]["origin_zip"])
        if not origin_el:
            _screenshot(self.page, "04-rate-request-missing-form")
            raise RuntimeError(
                f"Rate Request form not found at {self.page.url}. "
                "Check the URL or update ffe-selectors.json → quote_form."
            )

        print(f'[FFE] Rate Request loaded: "{self.page.title()}"')

    # ─────────────────────────────────────────────────────────────────────────
    # Get a single quote
    # ─────────────────────────────────────────────────────────────────────────

    def get_quote(self, row: dict) -> dict:
        """
        row keys: origin_zip, dest_zip, weight, freight_class, pieces (optional), row_index
        Returns: {rate, transit_days, quote_number}  — any field may be None on parse failure
        """
        # Fresh form for every quote
        self.page.goto(CONFIG["urls"]["rate_request"], wait_until="load", timeout=30_000)

        cfg = CONFIG["quote_form"]

        # ── Origin / destination ──────────────────────────────────────────────
        origin_zip_padded = str(row["origin_zip"]).strip().zfill(5)
        dest_zip_padded = str(row["dest_zip"]).strip().zfill(5)
        self.page.fill(cfg["origin_zip"], origin_zip_padded)
        self.page.fill(cfg["dest_zip"],   dest_zip_padded)

        # ── Weight ───────────────────────────────────────────────────────────
        # page.fill() clears the field before typing, overwriting the default 0
        weight_str = str(int(float(str(row["weight"]))))
        if not self.page.query_selector(cfg["weight"]):
            raise RuntimeError(f"Weight field '{cfg['weight']}' not found on form.")
        self.page.fill(cfg["weight"], weight_str)

        # ── Freight class / commodity → FFE select option ────────────────────
        _select_class_option(self.page, cfg["freight_class"], str(row["freight_class"]))

        _screenshot(self.page, f"05-form-filled-row{row['row_index']}")

        # ── Submit ────────────────────────────────────────────────────────────
        # FFE may ignore clicks as an anti-automation measure. We click up to
        # MAX_CLICKS times; after each click we wait briefly for the page to
        # navigate to the result. Short timeout per attempt so we move on fast
        # if the click was ignored; full timeout on the last attempt.
        MAX_CLICKS = 6
        for click_num in range(1, MAX_CLICKS + 1):
            self.page.click(cfg["submit"], no_wait_after=True)
            print(f"  [FFE] Submit click {click_num}/{MAX_CLICKS}")
            wait_ms = 60_000 if click_num == MAX_CLICKS else 6_000
            try:
                self.page.wait_for_url("**/RateResult**", wait_until="load", timeout=wait_ms)
                break  # navigation happened — done
            except Exception:
                if click_num == MAX_CLICKS:
                    raise RuntimeError(
                        f"Rate Shipment button clicked {MAX_CLICKS} times "
                        "but page never navigated to result."
                    )
                self.page.wait_for_timeout(1_500)  # brief pause before next click

        _screenshot(self.page, f"06-results-row{row['row_index']}")

        if "/Account/Login" in self.page.url:
            raise RuntimeError("Session expired mid-job; re-login required.")

        # ── Parse results ─────────────────────────────────────────────────────
        res = CONFIG["results"]
        quote_number = _get_text(self.page, res["quote_number"])
        raw_rate     = _get_text(self.page, res["total_charge"])
        transit_days = _get_text(self.page, res["transit_days"])

        # Normalise rate — keep the dollar amount only if we got one
        rate = _parse_dollar(raw_rate)

        if not rate:
            print(
                f"[FFE]  ⚠ Row {row['row_index']}: no rate found on result page "
                f"({self.page.url}). "
                "Screenshot saved — check python/screenshots/ and update "
                "ffe-selectors.json → results → total_charge if the selector changed."
            )

        return {"rate": rate, "transit_days": transit_days, "quote_number": quote_number}

    # ─────────────────────────────────────────────────────────────────────────
    # Process all rows for a job
    # ─────────────────────────────────────────────────────────────────────────

    def process_job(
        self,
        rows: list[dict],
        username: str,
        password: str,
        on_row_done,
    ) -> None:
        """
        on_row_done(row_id, result_dict, error_str) — called after every row.
        result_dict keys: rate, transit_days, quote_number
        """
        self.login(username, password)
        self.navigate_to_rate_request()

        for i, row in enumerate(rows):
            result: dict = {}
            error: str | None = None

            for attempt in range(2):
                try:
                    result = self.get_quote(row)
                    error = None
                    break
                except Exception as exc:
                    error = str(exc)
                    _screenshot(self.page, f"error-attempt{attempt + 1}-row{row['row_index']}")
                    if attempt == 0:
                        short = error[:100].replace('\n', ' ')
                        print(f"  [retry] Row {row['row_index']} attempt 1 failed: {short}")
                        print(f"  [retry] Waiting 3s then retrying row {row['row_index']}…")
                        try:
                            self.navigate_to_rate_request()
                        except Exception:
                            pass
                        time.sleep(3)

            on_row_done(row["id"], result, error)

            if i < len(rows) - 1:
                time.sleep(DELAY_BETWEEN_QUOTES)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _select_class_option(page: Page, selector: str, value: str) -> None:
    """
    Select the FFE class/commodity dropdown option.
    Handles commodity descriptions ("Meats & Meat Products"), class labels
    ("Class 100"), bare numbers ("100"), and internal IDs as fallback.
    """
    # 1. Direct label match — works for commodity descriptions and "Class 100"
    try:
        page.select_option(selector, label=value, timeout=3_000)
        return
    except Exception:
        pass

    # 2. Bare number → "Class <n>" label (e.g. "100" → "Class 100")
    cleaned = re.sub(r"(?i)^class\s*", "", value.strip())
    try:
        page.select_option(selector, label=f"Class {cleaned}", timeout=3_000)
        return
    except Exception:
        pass

    # 3. Internal ID map fallback
    class_id = _resolve_class_id(value)
    page.select_option(selector, value=class_id)


def _parse_dollar(text: str | None) -> str | None:
    """Return the dollar amount string or None if nothing parseable."""
    if not text:
        return None
    # Accept strings like "$558.72 USD", "558.72", "$1,234.56"
    match = re.search(r"\$?([\d,]+\.?\d*)", text)
    if match:
        return "$" + match.group(1)
    return text.strip() or None
