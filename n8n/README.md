# n8n report workflow: setup

Workflow: **drishti report** (`DkfTjHE8j78jOR36`)

The data side is done: `POST /api/report` returns the whole document as JSON and
records its hash in the custody ledger. The workflow only has to render and
deliver it.

## Three fixes needed in the n8n editor

### 1. The IF node is miswired: the workflow cannot currently succeed

`Refuse Broken Chain` has **both** `Build HTML Report` and `Alert - Broken Chain`
on its **true** output. So when the chain verifies, it builds the report *and*
throws "REFUSED TO ISSUE REPORT", so every run fails.

Drag the `Alert - Broken Chain` connection from the **true** output to the
**false** output. True → Build HTML Report. False → Alert.

### 2. Paste the corrected Code node

`build_html_report.js` in this folder. The version in the workflow never renders
`awaitingReview`, so with 0 confirmed findings the document comes out with no
findings and no evidence images at all, which is the normal state before a
review pass is done.

Measured against the live payload:

| | before | after |
|---|---|---|
| HTML size | 37 KB | 2.87 MB |
| evidence images | 0 | 24 |
| awaiting-review section | absent | present |

### 3. Add SMTP credentials

The `Send Email` node has none, so delivery fails. Gmail needs an **App
Password** (Google Account → Security → 2-Step Verification → App passwords);
the account password will not work. Port 465 SSL or 587 STARTTLS.

Also replace the placeholders, `demo@drishti.ai` and `invigilator@drishti.ai`
do not exist. For a demo, send to your own address.

## To trigger it from the app

Swap `Manual Trigger` for a **Webhook** node (POST). Copy its Production URL
into `.env.local`:

```
N8N_REPORT_WEBHOOK=http://localhost:5678/webhook/<path>
```

Restart the dev server. The **Issue report** button in the Ledger view then
runs the whole flow. Without the variable the button returns a 501 explaining
what is missing, rather than failing silently.

The app proxies through `/api/report/dispatch` rather than calling n8n from the
browser: it keeps the webhook URL server-side and avoids a cross-origin request
n8n would reject.

## Known-good payload shape

`GET /api/report?job=<id>` previews without side effects; `POST` issues and
records. `&embed=1` inlines evidence images as base64 (~2.4-3 MB) so the
document is self-contained; drop it and the HTML references `evidence.url`
instead, which needs the app running to render.

## PDF output

`Convert to File` produced an `.html` attachment. To get a PDF, replace that
node with an **HTTP Request** node:

```
Method:            POST
URL:               http://localhost:3000/api/report/pdf
Send Body:         ON   (JSON, using fields below)
  html  =  {{ $json.html }}
Response Format:   File
Put Output in Field: data
```

Wire `Build HTML Report` -> this node -> `Send Email`. The email node already
attaches `data`, so it needs no change.

Rendering happens in `/api/report/pdf` via `puppeteer-core` driving the Chrome
or Edge already installed on the machine. `puppeteer-core` rather than
`puppeteer` avoids a ~150MB Chromium download, and rendering locally rather
than through a hosted HTML-to-PDF API matters more than the disk space: those
services would receive exam-hall stills of identifiable people as the price of
a nicer file format.

Measured: 2.88MB of HTML with 24 embedded evidence images renders to a 2.83MB
A4 PDF in ~11.5s. Override the browser with `CHROME_PATH` in `.env.local` if
neither Chrome nor Edge is in the usual place.

### The base64 trap

If the attachment ever arrives as ~22 bytes of binary junk, `Convert to File`
is set to **Move Base64 String to File** (`toBinary`), which base64-*decodes*
its input. Raw HTML fed to it decodes to garbage. The text operation is
**Convert to Text File** (`toText`).

Note also that n8n caches the registered copy of an active workflow: after
changing a node, toggling Inactive -> Active may be needed before
webhook-triggered runs pick the change up.
