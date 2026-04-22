import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { ShipmentRow, QuoteResult, QuoteStatus } from './types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'ffe-selectors.json'), 'utf-8')
) as FFEConfig

interface FFEConfig {
  urls: { login: string; customerPortal: string; rateQuote: string }
  login: { username: string; password: string; submit: string; errorMessage: string }
  quoteForm: { originZip: string; destZip: string; weight: string; freightClass: string; pieces: string; submit: string }
  results: { totalCharge: string; transitDays: string; quoteNumber: string }
  rateQuoteLinkText: string[]
}

export type ProgressCallback = (result: QuoteResult, progressCount: number) => void

const DELAY_BETWEEN_QUOTES_MS = 1500

export class FFEQuoter {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private readonly debugMode: boolean
  private readonly screenshotDir: string

  constructor(debugMode = false) {
    this.debugMode = debugMode
    this.screenshotDir = path.join(process.cwd(), 'server', 'screenshots')
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true })
    }
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: !this.debugMode,
      slowMo: this.debugMode ? 200 : 0,
    })
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    this.page = await this.context.newPage()
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = null
    this.context = null
    this.page = null
  }

  private async screenshot(name: string): Promise<void> {
    try {
      await this.page?.screenshot({
        path: path.join(this.screenshotDir, `${name}-${Date.now()}.png`),
        fullPage: true,
      })
    } catch {
      // Non-fatal
    }
  }

  private async tryFill(selector: string, value: string): Promise<boolean> {
    const el = await this.page!.$(selector)
    if (!el) return false
    await el.fill(value)
    return true
  }

  private async trySelect(selector: string, value: string): Promise<boolean> {
    const el = await this.page!.$(selector)
    if (!el) return false
    const tag = await el.evaluate((e) => (e as HTMLElement).tagName.toLowerCase())
    if (tag === 'select') {
      // Try exact match, then partial
      await this.page!.selectOption(selector, { value }).catch(() =>
        this.page!.selectOption(selector, { label: value }).catch(() =>
          this.page!.selectOption(selector, { value: `Class ${value}` }).catch(() => null)
        )
      )
    } else {
      await el.fill(value)
    }
    return true
  }

  async login(username: string, password: string): Promise<void> {
    const page = this.page!
    console.log(`[FFE] Navigating to login page…`)
    await page.goto(config.urls.login, { waitUntil: 'networkidle', timeout: 30000 })
    await this.screenshot('01-login-page')

    await page.fill(config.login.username, username)
    await page.fill(config.login.password, password)
    await this.screenshot('02-credentials-filled')

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click(config.login.submit),
    ]).catch(() => null)

    await this.screenshot('03-after-login')

    // Detect login failure
    const errorEl = await page.$(config.login.errorMessage)
    if (errorEl) {
      const msg = (await errorEl.textContent())?.trim()
      throw new Error(`Login failed: ${msg || 'Invalid credentials'}`)
    }
    if (page.url().includes('/Account/Login')) {
      throw new Error('Login failed — still on login page. Check username/password.')
    }
    console.log(`[FFE] Logged in successfully. Current URL: ${page.url()}`)
  }

  async navigateToRateQuote(): Promise<void> {
    const page = this.page!
    console.log(`[FFE] Navigating to rate quote page…`)

    await page.goto(config.urls.rateQuote, { waitUntil: 'networkidle', timeout: 30000 })
    await this.screenshot('04-rate-quote-attempt')

    // If redirected to login, session problem
    if (page.url().includes('/Account/Login')) {
      throw new Error('Redirected to login — session may have expired.')
    }

    // Check if we got a meaningful page (not 404/error)
    const pageTitle = await page.title()
    const isErrorPage =
      pageTitle.toLowerCase().includes('not found') ||
      pageTitle.toLowerCase().includes('error') ||
      pageTitle.toLowerCase().includes('404')

    if (!isErrorPage) {
      console.log(`[FFE] Rate quote page loaded: "${pageTitle}"`)
      return
    }

    // Fall back: search customer portal for rate quote link
    console.log(`[FFE] Direct URL failed, searching customer portal…`)
    await page.goto(config.urls.customerPortal, { waitUntil: 'networkidle', timeout: 30000 })
    await this.screenshot('04b-customer-portal')

    for (const linkText of config.rateQuoteLinkText) {
      const link = await page.$(`a:has-text("${linkText}")`)
      if (link) {
        console.log(`[FFE] Found rate quote link: "${linkText}"`)
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
          link.click(),
        ]).catch(() => null)
        await this.screenshot('04c-rate-page-via-link')
        return
      }
    }

    await this.screenshot('04d-portal-no-link-found')
    throw new Error(
      `Could not find the rate quote page.\n` +
        `Tried: ${config.urls.rateQuote}\n` +
        `Then searched customer portal for links: ${config.rateQuoteLinkText.join(', ')}\n` +
        `Screenshots saved to: server/screenshots/\n` +
        `Update "urls.rateQuote" in server/ffe-selectors.json and try again.`
    )
  }

  async getQuote(shipment: ShipmentRow): Promise<Partial<QuoteResult>> {
    const page = this.page!

    // Navigate fresh to the quote form for each shipment
    await page.goto(config.urls.rateQuote, { waitUntil: 'networkidle', timeout: 30000 })

    const filled = {
      origin: await this.tryFill(config.quoteForm.originZip, shipment.originZip),
      dest: await this.tryFill(config.quoteForm.destZip, shipment.destZip),
      weight: await this.tryFill(config.quoteForm.weight, String(shipment.weight)),
      class: await this.trySelect(config.quoteForm.freightClass, shipment.freightClass),
    }

    if (shipment.pieces) {
      await this.tryFill(config.quoteForm.pieces, String(shipment.pieces))
    }

    // Warn about unfilled required fields
    const missing = Object.entries(filled)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    if (missing.length > 0) {
      console.warn(`[FFE] Row ${shipment.rowIndex}: could not fill fields: ${missing.join(', ')}`)
      console.warn(`  Check selectors in server/ffe-selectors.json → quoteForm`)
    }

    await this.screenshot(`05-form-filled-row${shipment.rowIndex}`)

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click(config.quoteForm.submit),
    ]).catch(() => null)

    await this.screenshot(`06-results-row${shipment.rowIndex}`)

    // Extract quote data
    const getText = async (selector: string): Promise<string | undefined> => {
      const el = await page.$(selector)
      if (!el) return undefined
      return (await el.textContent())?.trim() || undefined
    }

    const rate = await getText(config.results.totalCharge)
    const transitDays = await getText(config.results.transitDays)
    const quoteNumber = await getText(config.results.quoteNumber)

    if (!rate) {
      console.warn(
        `[FFE] Row ${shipment.rowIndex}: no rate found in results. ` +
          `Check selectors in server/ffe-selectors.json → results. ` +
          `Screenshot: server/screenshots/06-results-row${shipment.rowIndex}-*.png`
      )
    }

    return { rate, transitDays, quoteNumber }
  }

  async processAll(
    shipments: ShipmentRow[],
    username: string,
    password: string,
    onProgress: ProgressCallback
  ): Promise<QuoteResult[]> {
    const results: QuoteResult[] = shipments.map((s) => ({
      ...s,
      status: 'pending' as QuoteStatus,
    }))

    try {
      await this.launch()
      await this.login(username, password)
      await this.navigateToRateQuote()

      for (let i = 0; i < shipments.length; i++) {
        const shipment = shipments[i]
        results[i].status = 'processing'
        onProgress({ ...results[i] }, i)

        try {
          const quote = await this.getQuote(shipment)
          results[i] = { ...results[i], ...quote, status: quote.rate ? 'complete' : 'error' }
          if (!quote.rate) {
            results[i].error = 'No rate returned — check selectors in ffe-selectors.json'
          }
        } catch (err) {
          results[i].status = 'error'
          results[i].error = err instanceof Error ? err.message : String(err)
          console.error(`[FFE] Row ${shipment.rowIndex} error:`, results[i].error)
          await this.screenshot(`error-row${shipment.rowIndex}`)
        }

        onProgress({ ...results[i] }, i + 1)

        // Polite delay between requests
        if (i < shipments.length - 1) {
          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_QUOTES_MS))
        }
      }
    } finally {
      await this.close()
    }

    return results
  }
}
