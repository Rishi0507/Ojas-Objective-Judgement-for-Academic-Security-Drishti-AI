const r = $input.item.json;

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const prov = r.provenance || {};
const meta = prov.metadata || {};
const qm = prov.qualityMetrics || {};
const sum = r.summary || {};

const confirmed = (r.confirmed || []).map(f => {
  let imgHtml = '<div style="color:#888; font-style:italic;">No evidence image captured.</div>';
  if (f.evidence && f.evidence.base64) {
    imgHtml = `
      <div style="margin-top:10px;">
        <img src="data:image/jpeg;base64,${f.evidence.base64}" style="max-width:100%; height:auto; border:1px solid #ddd; border-radius:6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
        <div style="font-family:monospace; font-size:11px; color:#555; margin-top:4px;">SHA256: ${esc(f.evidence.sha256)}</div>
      </div>
    `;
  } else if (f.evidence && f.evidence.url) {
    imgHtml = `
      <div style="margin-top:10px;">
        <a href="${esc(f.evidence.url)}" target="_blank" style="color:#2563eb;">View Evidence Snapshot</a>
        <div style="font-family:monospace; font-size:11px; color:#555; margin-top:4px;">SHA256: ${esc(f.evidence.sha256)}</div>
      </div>
    `;
  }

  const bboxStr = f.boundingBox ? `[${f.boundingBox.join(', ')}]` : 'N/A';
  const clipStr = f.clipVerification ? `Verdict: ${esc(f.clipVerification.verdict)} | ReadAs: "${esc(f.clipVerification.readAs)}" | Score: ${esc(f.clipVerification.score)}` : 'N/A';
  const condStr = f.conditions ? f.conditions.join(', ') : 'None flagged';
  
  const groundedHtml = (f.groundedExplanations || []).map(g => 
    `<li style="margin-bottom:4px;"><strong>Claim:</strong> ${esc(g.claim || g.reason)} <em>(Timestamp: ${esc(g.timestamp)}s, Support Frames: ${esc((g.supportFrames || []).join(', '))})</em></li>`
  ).join('');

  return `
    <div style="border:1px solid #fee2e2; background:#fff5f5; border-left:4px solid #dc2626; padding:16px; border-radius:6px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #fecaca; padding-bottom:8px; margin-bottom:12px;">
        <h4 style="margin:0; color:#991b1b; font-size:16px;">${esc(f.label || f.type)} (Track ID: ${esc(f.subject || 'N/A')})</h4>
        <span style="background:#dc2626; color:#fff; font-size:12px; font-weight:bold; padding:2px 8px; border-radius:12px;">Confirmed</span>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; font-size:13px; color:#374151;">
        <div><strong>Time:</strong> ${esc(f.startSec)}s – ${esc(f.endSec)}s (Duration: ${esc(f.durationSec)}s)</div>
        <div><strong>Frame Index:</strong> ${esc(f.frameIdx)}</div>
        <div><strong>Detector Confidence:</strong> ${(Number(f.detectorConfidence || 0) * 100).toFixed(1)}%</div>
        <div><strong>Bounding Box:</strong> ${esc(bboxStr)}</div>
      </div>
      <div style="margin-top:10px; font-size:13px; color:#374151;">
        <strong>Region Context:</strong> ${esc(f.regionContext ? f.regionContext.interpretation : 'N/A')}
      </div>
      <div style="margin-top:6px; font-size:13px; color:#374151;">
        <strong>CLIP Verification:</strong> ${clipStr}
      </div>
      <div style="margin-top:6px; font-size:13px; color:#374151;">
        <strong>Environmental Conditions:</strong> ${esc(condStr)}
      </div>
      ${groundedHtml ? `<div style="margin-top:10px; font-size:13px; color:#374151;"><strong>Grounded Explanations:</strong><ul style="margin:4px 0 0 18px; padding:0;">${groundedHtml}</ul></div>` : ''}
      ${imgHtml}
      <div style="margin-top:10px; font-size:12px; color:#6b7280; border-top:1px dashed #fca5a5; padding-top:6px;">
        Reviewed by operator -  Verdict: <strong>${esc(f.review ? f.review.verdict : 'N/A')}</strong>
      </div>
    </div>
  `;
}).join('') || '<div style="color:#6b7280; font-style:italic; padding:12px; background:#f9fafb; border-radius:6px;">No confirmed findings recorded for this exam session.</div>';

// Findings the system surfaced that no reviewer has ruled on yet.
// Without this the document is empty whenever the review pass is incomplete -
// which is exactly when someone most needs to see what is outstanding.
const awaitingRows = (r.awaitingReview || []).map(f => {
  let imgHtml = '<div style="color:#888; font-style:italic;">No evidence image captured.</div>';
  if (f.evidence && f.evidence.base64) {
    imgHtml = `<img src="data:image/jpeg;base64,${f.evidence.base64}" style="max-width:320px; border:1px solid #cbd5e1; border-radius:6px;" />
      <div style="font-family:monospace; font-size:10px; color:#64748b; margin-top:4px;">sha256 ${esc((f.evidence.sha256 || '').slice(0,32))}</div>`;
  }
  const region = f.regionContext ? esc(f.regionContext.interpretation) : '';
  const clip = f.clipVerification
    ? `CLIP: ${esc(f.clipVerification.verdict)}${f.clipVerification.readAs ? ' :  read as &quot;' + esc(f.clipVerification.readAs) + '&quot;' : ''}`
    : '';
  return `
  <div style="border:1px solid #e2e8f0; border-radius:8px; padding:14px; margin-bottom:12px;">
    <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div>
        <strong>${esc(f.label)}</strong>
        <div style="font-size:12px; color:#475569;">
          ${esc(f.type)} &middot; subject ${esc(f.subject || 'unknown')} &middot;
          ${Number(f.startSec).toFixed(2)}s&ndash;${Number(f.endSec).toFixed(2)}s &middot;
          detector confidence ${(Number(f.detectorConfidence) * 100).toFixed(0)}%
        </div>
      </div>
      <span style="align-self:flex-start; background:#fef3c7; color:#92400e; border:1px solid #fde68a; border-radius:999px; padding:2px 10px; font-size:11px;">awaiting review</span>
    </div>
    <div style="margin-top:10px;">${imgHtml}</div>
    ${region ? `<div style="font-size:12px; color:#475569; margin-top:8px;">${region}</div>` : ''}
    ${clip ? `<div style="font-size:12px; color:#475569; margin-top:4px;">${clip}</div>` : ''}
  </div>`;
}).join('');

const dismissedRows = (r.dismissed || []).map(f => `
  <tr style="border-bottom:1px solid #e5e7eb;">
    <td style="padding:8px; font-family:monospace;">${esc(f.subject || 'N/A')}</td>
    <td style="padding:8px;">${esc(f.label || f.type)}</td>
    <td style="padding:8px;">${esc(f.startSec)}s – ${esc(f.endSec)}s</td>
    <td style="padding:8px;">${(Number(f.detectorConfidence || 0) * 100).toFixed(1)}%</td>
    <td style="padding:8px; color:#6b7280;">Dismissed on Review</td>
  </tr>
`).join('');

const autoFilteredRows = (r.autoFiltered || []).map(f => `
  <tr style="border-bottom:1px solid #e5e7eb;">
    <td style="padding:8px; font-family:monospace;">${esc(f.subject || 'N/A')}</td>
    <td style="padding:8px;">${esc(f.label || f.type)}</td>
    <td style="padding:8px;">${esc(f.startSec)}s – ${esc(f.endSec)}s</td>
    <td style="padding:8px; color:#4b5563;">${esc(f.autoFilteredReason || 'CLIP zero-shot model suppressed low confidence match')}</td>
  </tr>
`).join('');

const integ = r.integrity || {};
const limitHtml = (integ.limitations || []).map(l => `<li style="margin-bottom:4px;">${esc(l)}</li>`).join('');

const method = r.method || {};
const detectorRows = Object.entries(method.detectors || {}).map(([key, d]) => `
  <tr style="border-bottom:1px solid #e5e7eb;">
    <td style="padding:8px; font-weight:bold; font-family:monospace;">${esc(key)}</td>
    <td style="padding:8px; font-size:12px;">${esc(d.measures)}</td>
    <td style="padding:8px; font-size:12px; color:#991b1b;">${esc(d.fails)}</td>
  </tr>
`).join('');

const custodyRows = (r.custodyLog || []).map(c => `
  <tr style="border-bottom:1px solid #e5e7eb; font-family:monospace; font-size:11px;">
    <td style="padding:6px 8px;">#${esc(c.seq)}</td>
    <td style="padding:6px 8px; font-weight:bold;">${esc(c.kind)}</td>
    <td style="padding:6px 8px;">${esc(c.subject)}</td>
    <td style="padding:6px 8px;">${esc(c.recordedAt)}</td>
    <td style="padding:6px 8px;" title="${esc(c.contentHash)}">${esc((c.contentHash || '').substring(0, 16))}...</td>
    <td style="padding:6px 8px;">${c.signed ? '<span style="color:#059669;">✓ Signed</span>' : '<span style="color:#6b7280;">Unsigned</span>'}</td>
  </tr>
`).join('');

const issued = r.issued || {};

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Exam Integrity Report -  ${esc(prov.sourceFilename || 'Drishti AI')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #1f2937; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); padding: 32px; }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header-title h1 { margin: 0; font-size: 24px; color: #1e3a8a; }
    .header-title div { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .badge-verified { background: #dcfce7; color: #15803d; border: 1px solid #86efac; font-weight: bold; font-size: 12px; padding: 4px 12px; border-radius: 16px; }
    .badge-failed { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; font-weight: bold; font-size: 12px; padding: 4px 12px; border-radius: 16px; }
    .section-title { font-size: 18px; font-weight: bold; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin: 28px 0 16px 0; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 6px; }
    .card-num { font-size: 22px; font-weight: bold; color: #1e3a8a; margin-top: 4px; }
    .card-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th { background: #f1f5f9; text-align: left; padding: 8px; font-weight: 600; color: #475569; border-bottom: 1px solid #cbd5e1; }
    .limitations-box { background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 14px; border-radius: 6px; font-size: 13px; color: #92400e; margin-top: 12px; }
    .footer { border-top: 1px solid #e2e8f0; margin-top: 36px; padding-top: 20px; font-size: 12px; color: #64748b; background: #f8fafc; border-radius: 6px; padding: 16px; }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- HEADER & PROVENANCE -->
    <div class="header">
      <div class="header-title">
        <h1>Exam Integrity Report</h1>
        <div>Job ID: <strong style="font-family:monospace;">${esc(prov.jobId)}</strong> | File: <strong>${esc(prov.sourceFilename || 'N/A')}</strong></div>
        <div style="font-size:11px; margin-top:2px;">Uploaded: ${esc(prov.uploadRecordedAt || 'N/A')}</div>
      </div>
      <div>
        ${integ.chainVerified ? '<span class="badge-verified">✓ Chain Verified</span>' : '<span class="badge-failed">⚠ Chain Unverified</span>'}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-label">Source SHA-256 Hash</div>
        <div style="font-family:monospace; font-size:11px; word-break:break-all; margin-top:4px; color:#1e293b;">${esc(prov.sourceSha256 || 'N/A')}</div>
      </div>
      <div class="card">
        <div class="card-label">Video Metadata</div>
        <div style="font-size:12px; margin-top:4px; color:#1e293b;">
          Resolution: <strong>${esc(meta.width)}x${esc(meta.height)}</strong> | FPS: <strong>${esc(meta.fps)}</strong> | Total Frames: <strong>${esc(meta.total_frames)}</strong>
        </div>
      </div>
    </div>

    <!-- SUMMARY -->
    <div class="section-title">Execution & Review Summary</div>
    <div class="grid-4">
      <div class="card">
        <div class="card-label">Total Findings</div>
        <div class="card-num">${esc(sum.findingsTotal || 0)}</div>
      </div>
      <div class="card">
        <div class="card-label">Auto-Filtered</div>
        <div class="card-num" style="color:#64748b;">${esc(sum.autoFilteredByClip || 0)}</div>
      </div>
      <div class="card">
        <div class="card-label">Confirmed</div>
        <div class="card-num" style="color:#dc2626;">${esc(sum.confirmed || 0)}</div>
      </div>
      <div class="card">
        <div class="card-label">Dismissed</div>
        <div class="card-num" style="color:#059669;">${esc(sum.dismissed || 0)}</div>
      </div>
    </div>
    <div style="margin-top:10px; font-size:13px; background:#f1f5f9; padding:10px 14px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
      <span>Presented for Review: <strong>${esc(sum.presentedForReview || 0)}</strong> | Awaiting Review: <strong>${esc(sum.awaitingReview || 0)}</strong></span>
      <span>Review Status: <strong>${sum.reviewComplete ? '<span style="color:#059669;">Complete</span>' : '<span style="color:#d97706;">In Progress / Partial</span>'}</strong></span>
    </div>

    <!-- CONFIRMED FINDINGS -->
    <div class="section-title">Confirmed Findings (${esc(sum.confirmed || 0)})</div>
    ${confirmed}

    <!-- DISMISSED FINDINGS -->
    <div class="section-title">Dismissed Findings (${esc(sum.dismissed || 0)})</div>
    <p style="font-size:12px; color:#6b7280; margin:-8px 0 8px 0;">Non-negotiable audit record: presenting rejected findings establishes the false-positive review rate.</p>
    ${r.dismissed && r.dismissed.length > 0 ? `
    <table>
      <thead>
        <tr>
          <th>Track ID</th>
          <th>Finding Type</th>
          <th>Time Window</th>
          <th>Detector Confidence</th>
          <th>Review Result</th>
        </tr>
      </thead>
      <tbody>
        ${dismissedRows}
      </tbody>
    </table>
    ` : '<div style="font-size:13px; color:#6b7280; font-style:italic;">No findings were dismissed during operator review.</div>'}

    <!-- AUTO-FILTERED FINDINGS -->
    <div class="section-title">Auto-Filtered Findings (${esc(sum.autoFilteredByClip || 0)})</div>
    ${r.awaitingReview && r.awaitingReview.length > 0 ? `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px; border-bottom:2px solid #0f172a; padding-bottom:6px;">
        Awaiting review (${r.awaitingReview.length})
      </h2>
      <p style="font-size:12px; color:#475569; margin:8px 0 12px;">
        These were surfaced by the detectors and have not yet been accepted or rejected by a
        reviewer. They are not findings of misconduct and must not be treated as such.
      </p>
      ${awaitingRows}
    </div>` : ''}

    ${r.autoFiltered && r.autoFiltered.length > 0 ? `
    <table>
      <thead>
        <tr>
          <th>Track ID</th>
          <th>Finding Type</th>
          <th>Time Window</th>
          <th>Suppression Reason</th>
        </tr>
      </thead>
      <tbody>
        ${autoFilteredRows}
      </tbody>
    </table>
    ` : '<div style="font-size:13px; color:#6b7280; font-style:italic;">No findings were suppressed by automated filters.</div>'}

    <!-- INTEGRITY & LIMITATIONS -->
    <div class="section-title">Custody Chain Integrity</div>
    <div style="font-size:13px; color:#334155; line-height:1.5;">
      <div><strong>Status Summary:</strong> ${esc(integ.summary)}</div>
      <div><strong>Entries Checked:</strong> ${esc(integ.entriesInChain)} (${esc(integ.signedEntries)} signed) | <strong>Head Hash:</strong> <span style="font-family:monospace; font-size:11px;">${esc(integ.headHash)}</span></div>
      <div><strong>Merkle Root:</strong> <span style="font-family:monospace; font-size:11px;">${esc(integ.merkleRoot || 'Not Anchored')}</span></div>
    </div>
    ${limitHtml ? `
    <div class="limitations-box">
      <strong>System Limitations & Scope:</strong>
      <ul style="margin:6px 0 0 18px; padding:0;">
        ${limitHtml}
      </ul>
    </div>
    ` : ''}

    <!-- METHOD -->
    <div class="section-title">Methodology & Detector Notes</div>
    <p style="font-size:12px; color:#475569; margin-bottom:12px;">${esc(method.statement)}</p>
    <table>
      <thead>
        <tr>
          <th>Detector</th>
          <th>What it Measures</th>
          <th>Known Failure Modes</th>
        </tr>
      </thead>
      <tbody>
        ${detectorRows}
      </tbody>
    </table>
    <div style="margin-top:12px; font-size:12px; color:#64748b; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      <div><strong>Privacy Policy:</strong> ${esc(method.privacy)}</div>
      <div><strong>Accuracy Notice:</strong> ${esc(method.accuracy)}</div>
    </div>

    <!-- CUSTODY LOG -->
    <div class="section-title">Audit Custody Log</div>
    <table>
      <thead>
        <tr>
          <th>Seq</th>
          <th>Kind</th>
          <th>Subject</th>
          <th>Timestamp</th>
          <th>Content Digest</th>
          <th>Signature</th>
        </tr>
      </thead>
      <tbody>
        ${custodyRows}
      </tbody>
    </table>

    <!-- FOOTER / ISSUED -->
    <div class="footer">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div><strong>Report Hash:</strong> <span style="font-family:monospace;">${esc(issued.reportHash || 'UNCOMMITTED')}</span></div>
          <div><strong>Ledger Sequence:</strong> ${esc(issued.ledgerSeq || 'N/A')}</div>
        </div>
        <div style="text-align:right; font-size:11px; color:#94a3b8;">
          Issued by Drishti AI Automated Pipeline
        </div>
      </div>
      <div style="margin-top:10px; font-size:11px; color:#475569; border-top:1px dashed #cbd5e1; padding-top:8px;">
        ${esc(issued.note)}
      </div>
    </div>

  </div>
</body>
</html>`;

return {
  json: {
    html: html,
    provenance: prov,
    summary: sum,
    integrity: integ,
    issued: issued
  }
};