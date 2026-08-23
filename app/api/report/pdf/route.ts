import { NextRequest } from 'next/server'
import fs from 'fs'

/**
 * Renders report HTML to PDF using the browser already installed on this
 * machine.
 *
 *   POST /api/report/pdf   body: { html: "<!DOCTYPE html>..." }  -> application/pdf
 *
 * puppeteer-core rather than puppeteer: the full package downloads its own
 * ~150MB Chromium, which is wasted on a machine that already has Chrome and
 * Edge. Pointing at the installed binary keeps the install small and, more
 * importantly, keeps this working on a machine with no internet - which is the
 * whole premise of an offline exam-hall system.
 *
 * Rendering locally rather than through a hosted HTML-to-PDF API is the same
 * decision: those services would receive exam-hall stills of identifiable
 * people as the price of a nicer file format.
 */

/** Browsers to try, in order. Windows always has Edge, so this rarely fails. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  // Forward slashes deliberately: Node accepts them on Windows, and they
  // survive every layer of quoting without the backslash-escaping bugs that
  // silently turn a valid path into "C:Program FilesGoogle...".
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean) as string[]

function findBrowser(): string | null {
  for (const p of CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // unreadable path - keep looking rather than fail the request
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  const executablePath = findBrowser()
  if (!executablePath) {
    return Response.json(
      {
        error:
          'No Chrome or Edge found for PDF rendering. Set CHROME_PATH in .env.local to the browser executable.',
      },
      { status: 501 }
    )
  }

  let browser
  try {
    const body = await request.json()
    const html = String(body?.html ?? '')
    if (!html.trim()) {
      return Response.json({ error: 'Body must contain an "html" field.' }, { status: 400 })
    }

    const puppeteer = (await import('puppeteer-core')).default
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })

    const page = await browser.newPage()
    // The document carries every image as a data: URI, so nothing is fetched
    // over the network; waiting for network idle would just add a timeout.
    await page.setContent(html, { waitUntil: 'load', timeout: 120_000 })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true, // the report leans on background colours for its badges
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#64748b;padding:0 12mm;display:flex;justify-content:space-between;">' +
        '<span>DrishtiAI &mdash; exam integrity report</span>' +
        '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    })

    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="drishti-report.pdf"',
      },
    })
  } catch (err: any) {
    console.error('PDF render failed:', err)
    return Response.json({ error: err?.message ?? 'PDF render failed' }, { status: 500 })
  } finally {
    // Always close: a leaked browser process survives the request and each one
    // holds a few hundred MB.
    try {
      await browser?.close()
    } catch {
      /* already gone */
    }
  }
}
