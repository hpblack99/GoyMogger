import json
import re
import time
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

CONFIG = json.loads((Path(__file__).parent / "ffe-selectors.json").read_text())
SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

CLASS_ID_MAP: dict[str, str] = CONFIG["class_id_map"]

DELAY_BETWEEN_QUOTES = 1.5


def _screenshot(page: Page, name: str) -> None:
    try:
        ts = datetime.now().strftime("%H%M%S%f")
        page.screenshot(path=str(SCREENSHOT_DIR / f"{name}-{ts}.png"), full_page=True)
    except Exception:
        pass


def _resolve_class_id(freight_class: str) -> str:
    raw = str(freight_class).strip()
    cleaned = re.sub(r"(?i)^class\s*", "", raw).strip()
    if cleaned in CLASS_ID_MAP:
        return CLASS_ID_MAP[cleaned]
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


def _find_row_value(page: Page, row_label: str, cell_index: int = -1) -> str | None:
    try:
        rows = page.query_selector_all("tr")
        for row in rows:
            row_text = (row.text_content() or "").lower()
            if row_label.lower() in row_text:
                cells = row.query_selector_all("td")
                if cells and len(cells) > abs(cell_index):
                    cell_text = cells[cell_index].text_content()
                    if cell_text and cell_text.strip():
                        return cell_text.strip()
    except Exception:
        pass
    return None


class FFEQuoter:
    def __init__(self, debug: bool = False):
        self.debug = debug
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._username: str | None = None
        self._password: str | None = None
        self._job_accessorials: list[str] = []

    def __enter__(self):
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(
            headless=False,
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

    def _is_browser_alive(self) -> bool:
        try:
            _ = self.page.url
            return True
        except Exception:
            return False

    def _relogin_if_needed(self) -> bool:
        if "/Account/Login" not in self.page.url:
            return False
        if not self._username:
            raise RuntimeError("Session expired and no credentials stored for re-login.")
        print("[FFE] Session expired — re-logging in…")
        self.login(self._username, self._password)
        return True

    def _recover_session(self) -> None:
        if self._is_browser_alive():
            if self._relogin_if_needed():
                self.page.goto(CONFIG["urls"]["rate_request"], wait_until="load", timeout=30_000)
            return

        print("[FFE] Browser closed — relaunching…")
        for fn in (lambda: self._browser.close(), lambda: self._playwright.stop()):
            try:
                fn()
            except Exception:
                pass

        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(
            headless=False,
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

        if not self._username:
            raise RuntimeError("Browser closed and no credentials stored for re-login.")
        self.login(self._username, self._password)
        self.navigate_to_rate_request()
        print("[FFE] Browser relaunched and session restored.")

    def login(self, username: str, password: str) -> None:
        self._username = username
        self._password = password
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

    def navigate_to_rate_request(self) -> None:
        print("[FFE] Navigating to Rate Request…")
        self.page.goto(CONFIG["urls"]["rate_request"], wait_until="load", timeout=30_000)
        _screenshot(self.page, "04-rate-request")

        if self._relogin_if_needed():
            self.page.goto(CONFIG["urls"]["rate_request"], wait_until="load", timeout=30_000)

        origin_el = self.page.query_selector(CONFIG["quote_form"]["origin_zip"])
        if not origin_el:
            _screenshot(self.page, "04-rate-request-missing-form")
            raise RuntimeError(
                f"Rate Request form not found at {self.page.url}. "
                "Check the URL or update ffe-selectors.json → quote_form."
            )

        print(f'[FFE] Rate Request loaded: "{self.page.title()}"')

    def get_quote(self, row: dict) -> dict:
        self.page.goto(CONFIG["urls"]["rate_request"], wait_until="load", timeout=30_000)

        if self._relogin_if_needed():
            self.page.goto(CONFIG["urls"]["rate_request"], wait_until="load", timeout=30_000)

        cfg = CONFIG["quote_form"]

        origin_zip_padded = str(row["origin_zip"]).strip().zfill(5)
        dest_zip_padded = str(row["dest_zip"]).strip().zfill(5)
        self.page.fill(cfg["origin_zip"], origin_zip_padded)
        self.page.fill(cfg["dest_zip"],   dest_zip_padded)

        weight_str = str(int(float(str(row["weight"]))))
        if not self.page.query_selector(cfg["weight"]):
            raise RuntimeError(f"Weight field '{cfg['weight']}' not found on form.")
        self.page.fill(cfg["weight"], weight_str)

        _select_class_option(self.page, cfg["freight_class"], str(row["freight_class"]))

        self._apply_accessorials()

        _screenshot(self.page, f"05-form-filled-row{row['row_index']}")

        MAX_CLICKS = 6
        for click_num in range(1, MAX_CLICKS + 1):
            if "RateResult" in self.page.url:
                print(f"  [FFE] Already on result page before click {click_num} — done")
                break

            try:
                self.page.click(cfg["submit"], no_wait_after=True, timeout=8_000)
            except Exception:
                if "RateResult" in self.page.url:
                    print(f"  [FFE] Click failed but already on result page — continuing")
                    break
                if click_num == MAX_CLICKS:
                    raise RuntimeError(
                        f"Submit button not clickable after {MAX_CLICKS} attempts."
                    )
                self.page.wait_for_timeout(1_500)
                continue

            print(f"  [FFE] Submit click {click_num}/{MAX_CLICKS}")
            wait_ms = 60_000 if click_num == MAX_CLICKS else 6_000
            try:
                self.page.wait_for_url("**/RateResult**", wait_until="load", timeout=wait_ms)
                break
            except Exception:
                if "RateResult" in self.page.url:
                    print(f"  [FFE] Load timed out but already on result page — continuing")
                    break
                if click_num == MAX_CLICKS:
                    raise RuntimeError(
                        f"Rate Shipment button clicked {MAX_CLICKS} times "
                        "but page never navigated to result."
                    )
                self.page.wait_for_timeout(1_500)

        _screenshot(self.page, f"06-results-row{row['row_index']}")

        if "/Account/Login" in self.page.url:
            raise RuntimeError("Session expired mid-job; re-login required.")

        res = CONFIG["results"]
        quote_number = _get_text(self.page, res["quote_number"])
        raw_rate     = _get_text(self.page, res["total_charge"])

        if not raw_rate:
            raw_rate = _find_row_value(self.page, "Total Estimated Charges")
        if not raw_rate:
            raw_rate = _find_row_value(self.page, "Total Estimated Charge")

        transit_days = _get_text(self.page, res["transit_days"])
        rate = _parse_dollar(raw_rate)

        if not rate:
            print(
                f"[FFE]  ⚠ Row {row['row_index']}: no rate found on result page "
                f"({self.page.url}). "
                "Screenshot saved — check python/screenshots/ and update "
                "ffe-selectors.json → results → total_charge if the selector changed."
            )

        return {"rate": rate, "transit_days": transit_days, "quote_number": quote_number}

    def _apply_accessorials(self) -> None:
        if not self._job_accessorials:
            return
        acc_map = CONFIG.get("accessorials", {})
        for key in self._job_accessorials:
            label_text = acc_map.get(key)
            if not label_text:
                continue
            try:
                cb = self.page.get_by_label(re.compile(re.escape(label_text), re.IGNORECASE))
                if cb.count() > 0 and not cb.first.is_checked():
                    cb.first.check()
            except Exception as e:
                print(f"  [FFE] Warning: could not check accessorial '{key}': {e}")

    def process_job(
        self,
        rows: list[dict],
        username: str,
        password: str,
        on_row_done,
        accessorials: list[str] | None = None,
    ) -> None:
        self._job_accessorials = list(accessorials or [])
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
                    try:
                        _screenshot(self.page, f"error-attempt{attempt + 1}-row{row['row_index']}")
                    except Exception:
                        pass
                    if attempt == 0:
                        short = error[:100].replace('\n', ' ')
                        print(f"  [retry] Row {row['row_index']} attempt 1 failed: {short}")
                        print(f"  [retry] Recovering session then retrying row {row['row_index']}…")
                        time.sleep(3)
                        try:
                            self._recover_session()
                        except Exception as recover_err:
                            print(f"  [retry] Session recovery failed: {recover_err}")

            on_row_done(row["id"], result, error)

            if i < len(rows) - 1:
                time.sleep(DELAY_BETWEEN_QUOTES)


def _select_class_option(page: Page, selector: str, value: str) -> None:
    try:
        page.select_option(selector, label=value, timeout=3_000)
        return
    except Exception:
        pass

    cleaned = re.sub(r"(?i)^class\s*", "", value.strip())
    try:
        page.select_option(selector, label=f"Class {cleaned}", timeout=3_000)
        return
    except Exception:
        pass

    class_id = _resolve_class_id(value)
    page.select_option(selector, value=class_id)


def _parse_dollar(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"\$?([\d,]+\.?\d*)", text)
    if match:
        return "$" + match.group(1)
    return text.strip() or None
