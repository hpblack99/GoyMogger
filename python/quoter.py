"""
FFE website automation using Playwright (Python).
All selectors and URLs are in ffe-selectors.json — edit that file to fix issues.
Set DEBUG=true in your .env to run with a visible browser window.
Screenshots are saved to python/screenshots/ at every key step.
"""

import json
import time
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

CONFIG = json.loads((Path(__file__).parent / "ffe-selectors.json").read_text())
SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

DELAY_BETWEEN_QUOTES = 1.5  # seconds — be polite to the server


def _screenshot(page: Page, name: str) -> None:
    try:
        path = SCREENSHOT_DIR / f"{name}-{datetime.now().strftime('%H%M%S%f')}.png"
        page.screenshot(path=str(path), full_page=True)
    except Exception:
        pass


def _try_fill(page: Page, selector: str, value: str) -> bool:
    """Try each comma-separated selector until one works."""
    for sel in [s.strip() for s in selector.split(",")]:
        try:
            el = page.query_selector(sel)
            if el:
                el.fill(value)
                return True
        except Exception:
            continue
    return False


def _try_select_or_fill(page: Page, selector: str, value: str) -> bool:
    """For <select> elements select by value/label; for inputs, fill."""
    for sel in [s.strip() for s in selector.split(",")]:
        try:
            el = page.query_selector(sel)
            if not el:
                continue
            tag = el.evaluate("e => e.tagName.toLowerCase()")
            if tag == "select":
                for attempt in [
                    lambda: page.select_option(sel, value=value),
                    lambda: page.select_option(sel, label=value),
                    lambda: page.select_option(sel, label=f"Class {value}"),
                    lambda: page.select_option(sel, value=f"Class {value}"),
                ]:
                    try:
                        attempt()
                        return True
                    except Exception:
                        continue
            else:
                el.fill(value)
                return True
        except Exception:
            continue
    return False


def _get_text(page: Page, selector: str) -> str | None:
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
            headless=not self.debug,
            slow_mo=250 if self.debug else 0,
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
        self.page.goto(CONFIG["urls"]["login"], wait_until="networkidle", timeout=30_000)
        _screenshot(self.page, "01-login-page")

        self.page.fill(CONFIG["login"]["username"], username)
        self.page.fill(CONFIG["login"]["password"], password)
        _screenshot(self.page, "02-credentials-filled")

        with self.page.expect_navigation(wait_until="networkidle", timeout=30_000):
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
    # Navigate to rate quote page
    # ─────────────────────────────────────────────────────────────────────────

    def navigate_to_rate_quote(self) -> None:
        print("[FFE] Navigating to rate quote page…")
        self.page.goto(CONFIG["urls"]["rate_quote"], wait_until="networkidle", timeout=30_000)
        _screenshot(self.page, "04-rate-quote-attempt")

        if "/Account/Login" in self.page.url:
            raise RuntimeError("Redirected to login — session expired.")

        title = self.page.title().lower()
        if "not found" not in title and "error" not in title and "404" not in title:
            print(f'[FFE] Rate quote page loaded: "{self.page.title()}"')
            return

        # Fall back: scan customer portal for a rate quote link
        print("[FFE] Direct URL failed — searching customer portal for rate quote link…")
        self.page.goto(CONFIG["urls"]["customer_portal"], wait_until="networkidle", timeout=30_000)
        _screenshot(self.page, "04b-customer-portal")

        for text in CONFIG["rate_quote_link_text"]:
            link = self.page.query_selector(f'a:has-text("{text}")')
            if link:
                print(f'[FFE] Found link: "{text}"')
                with self.page.expect_navigation(wait_until="networkidle", timeout=30_000):
                    link.click()
                _screenshot(self.page, "04c-rate-page-via-link")
                return

        _screenshot(self.page, "04d-link-not-found")
        raise RuntimeError(
            f"Could not find the rate quote page.\n"
            f"Tried URL: {CONFIG['urls']['rate_quote']}\n"
            f"Then searched for links: {CONFIG['rate_quote_link_text']}\n"
            f"Screenshots saved to: python/screenshots/\n"
            f"Fix 'urls.rate_quote' in python/ffe-selectors.json and retry."
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Get a single quote
    # ─────────────────────────────────────────────────────────────────────────

    def get_quote(self, row: dict) -> dict:
        """
        row keys: origin_zip, dest_zip, weight, freight_class, pieces (optional)
        Returns dict with: rate, transit_days, quote_number (any may be None)
        """
        self.page.goto(CONFIG["urls"]["rate_quote"], wait_until="networkidle", timeout=30_000)

        cfg = CONFIG["quote_form"]
        filled = {
            "origin_zip":    _try_fill(self.page, cfg["origin_zip"],    str(row["origin_zip"])),
            "dest_zip":      _try_fill(self.page, cfg["dest_zip"],      str(row["dest_zip"])),
            "weight":        _try_fill(self.page, cfg["weight"],        str(row["weight"])),
            "freight_class": _try_select_or_fill(self.page, cfg["freight_class"], str(row["freight_class"])),
        }
        if row.get("pieces"):
            _try_fill(self.page, cfg["pieces"], str(row["pieces"]))

        missing = [k for k, v in filled.items() if not v]
        if missing:
            print(f"[FFE]  ⚠ Row {row['row_index']}: could not fill — {missing}")
            print( "       Update selectors in python/ffe-selectors.json → quote_form")

        _screenshot(self.page, f"05-form-filled-row{row['row_index']}")

        with self.page.expect_navigation(wait_until="networkidle", timeout=30_000):
            self.page.click(cfg["submit"])

        _screenshot(self.page, f"06-results-row{row['row_index']}")

        res = CONFIG["results"]
        rate         = _get_text(self.page, res["total_charge"])
        transit_days = _get_text(self.page, res["transit_days"])
        quote_number = _get_text(self.page, res["quote_number"])

        if not rate:
            print(
                f"[FFE]  ⚠ Row {row['row_index']}: no rate found. "
                f"Check selectors → results in ffe-selectors.json. "
                f"Screenshot: python/screenshots/06-results-row{row['row_index']}-*.png"
            )

        return {"rate": rate, "transit_days": transit_days, "quote_number": quote_number}

    # ─────────────────────────────────────────────────────────────────────────
    # Process all rows for a job
    # ─────────────────────────────────────────────────────────────────────────

    def process_job(self, rows: list[dict], username: str, password: str, on_row_done) -> None:
        """
        on_row_done(row_id, result_dict, error_str) called after each row.
        result_dict has keys: rate, transit_days, quote_number
        """
        self.login(username, password)
        self.navigate_to_rate_quote()

        for i, row in enumerate(rows):
            try:
                result = self.get_quote(row)
                on_row_done(row["id"], result, None)
            except Exception as exc:
                on_row_done(row["id"], {}, str(exc))
                _screenshot(self.page, f"error-row{row['row_index']}")

            if i < len(rows) - 1:
                time.sleep(DELAY_BETWEEN_QUOTES)
