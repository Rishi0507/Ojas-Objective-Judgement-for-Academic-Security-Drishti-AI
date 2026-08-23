import { NextRequest, NextResponse } from 'next/server'
import { getCurrentPipelineDir } from '@/lib/currentVideo'

/**
 * Hands a job to the n8n report workflow.
 *
 * The frontend cannot call n8n directly: the webhook URL would have to be
 * baked into client JS (making the automation endpoint public), and a browser
 * request to a different port is a cross-origin call n8n does not permit by
 * default. Proxying keeps the URL server-side and turns it into a same-origin
 * fetch for the page.
 *
 * Deliberately thin. The workflow owns rendering and delivery; this only tells
 * it which job to render, so the two can change independently.
 */
export async function POST(request: NextRequest) {
  const webhook = process.env.N8N_REPORT_WEBHOOK?.trim()
  if (!webhook) {
    return NextResponse.json(
      {
        error:
          'N8N_REPORT_WEBHOOK is not set. Add the workflow\'s Production webhook URL to .env.local and restart.',
      },
      { status: 501 }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const jobId = body?.jobId || getCurrentPipelineDir()

    // The workflow builds a full report with embedded evidence, so this is
    // slow by nature - a short timeout would report failure on a run that is
    // actually progressing.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 180_000)

    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { error: `n8n returned ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      )
    }

    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text.slice(0, 500) }
    }
    return NextResponse.json({ ok: true, jobId, workflow: parsed })
  } catch (err: any) {
    const aborted = err?.name === 'AbortError'
    return NextResponse.json(
      {
        error: aborted
          ? 'The workflow did not respond within 3 minutes. It may still be running - check the n8n execution log.'
          : `Could not reach n8n: ${err?.message ?? err}`,
      },
      { status: 504 }
    )
  }
}
