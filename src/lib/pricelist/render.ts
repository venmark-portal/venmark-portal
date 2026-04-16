/**
 * Puppeteer-wrapper der tager HTML og producerer en PDF som Buffer.
 *
 * Hetzner-setup:
 *   - puppeteer installeres normalt med embedded Chromium
 *   - på Ubuntu skal disse pakker være installeret:
 *       apt install -y \
 *         ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
 *         libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 \
 *         libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
 *         xdg-utils
 *   - alternativt: brug systemets Chromium og peg puppeteer på det med
 *       PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
 */

import type { Browser } from "puppeteer";

/**
 * Lazy-loaded browser instance. Genbruges mellem kald for at undgå
 * opstartstid (~500ms). Nulstilles hvis browseren crasher eller lukker.
 */
let cachedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.connected) {
    return cachedBrowser;
  }

  // Dynamic import så build-toolchain ikke crasher hvis puppeteer mangler
  // i development (fx på en udvikler-maskine uden Chromium).
  const puppeteer = await import("puppeteer");

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  cachedBrowser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
    ...(executablePath ? { executablePath } : {}),
  });

  cachedBrowser.on("disconnected", () => {
    cachedBrowser = null;
  });

  return cachedBrowser;
}

export interface RenderPdfOptions {
  /** HTML-dokument som streng - skal være komplet med <html>...</html> */
  html: string;
  /** PDF header-template (valgfri, bruges hvis du vil have sideantal mm.) */
  headerTemplate?: string;
  /** PDF footer-template */
  footerTemplate?: string;
  /** Landscape (default true - matcher det originale prislisteformat) */
  landscape?: boolean;
}

/**
 * Render HTML til PDF Buffer via headless Chromium.
 * Timeout: 30s pr. kald - burde være rigeligt selv for 500+ varer.
 */
export async function renderPdfFromHtml(
  opts: RenderPdfOptions
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(opts.html, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      landscape: opts.landscape ?? true,
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "12mm", left: "10mm" },
      displayHeaderFooter: Boolean(opts.headerTemplate || opts.footerTemplate),
      headerTemplate: opts.headerTemplate ?? "<div></div>",
      footerTemplate:
        opts.footerTemplate ??
        `<div style="font-size:7pt;color:#888;width:100%;text-align:center;">
           Venmark Fisk A/S — Side <span class="pageNumber"></span> af <span class="totalPages"></span>
         </div>`,
    });

    return Buffer.from(pdfBytes);
  } finally {
    await page.close();
  }
}

/**
 * Luk cached browser (kald eventuelt fra graceful shutdown).
 */
export async function closeBrowser(): Promise<void> {
  if (cachedBrowser) {
    await cachedBrowser.close();
    cachedBrowser = null;
  }
}
