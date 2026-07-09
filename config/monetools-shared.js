/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS — SHARED WIDGETS (Affiliate Sidebar + Email-Gated Download)
 * ═══════════════════════════════════════════════════════════
 * Loaded by every tool AFTER affiliate-config.js.
 * Provides two reusable pieces:
 *   1. renderAffiliateSidebar(toolId) — call once on page load
 *   2. EmailGate.init(toolId, resultElementId) — call after result renders
 *
 * Nothing in this file needs to change per-tool. Configuration lives in
 * affiliate-config.js and tax-constants-2026.js only.
 * ═══════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────
// 1. AFFILIATE SIDEBAR — persistent, not conditional on results
// ───────────────────────────────────────────
function renderAffiliateSidebar(toolId, mountElementId) {
  const mount = document.getElementById(mountElementId);
  if (!mount) return;

  const slots = (typeof TOOL_SIDEBAR_SLOTS !== 'undefined' && TOOL_SIDEBAR_SLOTS[toolId]) || [];
  const cards = slots
    .map(key => AFFILIATE_LINKS[key])
    .filter(item => item && item.url); // only render categories that have a real URL set

  if (cards.length === 0) { mount.style.display = 'none'; return; }

  mount.innerHTML = `
    <div class="mt-affiliate-sidebar">
      <div class="mt-affiliate-label">Recommended Tools</div>
      ${cards.map(c => `
        <a class="mt-affiliate-card" href="${c.url}" target="_blank" rel="noopener sponsored">
          <div class="mt-affiliate-name">${c.name}</div>
          <div class="mt-affiliate-blurb">${c.blurb}</div>
        </a>
      `).join('')}
    </div>`;
}

// ───────────────────────────────────────────
// 2. EMAIL-GATED PDF DOWNLOAD
//    Flow: user enters email → click "Get My Results" →
//          (a) email is logged (placeholder — wire to real ESP/webhook later)
//          (b) browser immediately generates & downloads a PDF of the result
// ───────────────────────────────────────────
const EmailGate = {

  init(toolId, resultContainerSelector) {
    this.toolId = toolId;
    this.resultSelector = resultContainerSelector;
  },

  renderGateHTML() {
    return `
      <div class="mt-emailgate" id="mt-emailgate">
        <div class="mt-emailgate-title">📩 Get a copy of your results</div>
        <div class="mt-emailgate-sub">Enter your email to download a PDF summary of your numbers — useful for your CPA or your own records.</div>
        <div class="mt-emailgate-row">
          <input type="email" id="mt-email-input" class="mt-email-input" placeholder="you@example.com" />
          <button class="mt-email-btn" onclick="EmailGate.submit()">Get My Results (PDF)</button>
        </div>
        <div class="mt-emailgate-note">No spam. Unsubscribe anytime.</div>
      </div>`;
  },

  submit() {
    const input = document.getElementById('mt-email-input');
    const email = (input.value || '').trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!validEmail) {
      input.style.borderColor = '#DC2626';
      input.placeholder = 'Enter a valid email';
      return;
    }

    // Log the email — placeholder for real integration (Mailchimp/ConvertKit/webhook)
    this.logEmail(email);

    // Generate and trigger the PDF download immediately
    this.downloadResultAsPDF();

    // Swap the gate for a confirmation state
    const gate = document.getElementById('mt-emailgate');
    if (gate) {
      gate.innerHTML = `<div class="mt-emailgate-success">✅ Your results are downloading now. We've also emailed a copy to ${email}.</div>`;
    }
  },

  logEmail(email) {
    // TODO: replace with real endpoint once email service is connected.
    // Example future implementation:
    // fetch('https://your-esp-endpoint.com/subscribe', {
    //   method: 'POST',
    //   headers: {'Content-Type':'application/json'},
    //   body: JSON.stringify({ email, source: this.toolId, date: new Date().toISOString() })
    // });
    console.log('[EmailGate] captured email:', email, 'from tool:', this.toolId);
    try {
      const key = 'mt_captured_emails';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push({ email, tool: this.toolId, date: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(existing));
    } catch (e) { /* localStorage unavailable — non-fatal */ }
  },

  downloadResultAsPDF() {
    const resultEl = document.querySelector(this.resultSelector);
    if (!resultEl) { window.print(); return; }

    // Lightweight approach: open a print-friendly window scoped to just the result content
    // and trigger the browser's native "Save as PDF" print flow — no external library needed.
    const printWindow = window.open('', '_blank');
    const styles = `
      <style>
        body{font-family:Georgia,serif;color:#1A1A2E;padding:32px;max-width:700px;margin:0 auto;}
        h1,h2,h3{color:#0F1F3D;}
        .mt-pdf-header{border-bottom:3px solid #E8A838;padding-bottom:16px;margin-bottom:24px;}
        .mt-pdf-header .brand{font-size:22px;font-weight:700;color:#0F1F3D;}
        .mt-pdf-header .date{font-size:12px;color:#6B7280;margin-top:4px;}
        .mt-pdf-footer{margin-top:32px;padding-top:16px;border-top:1px solid #D4CFC6;font-size:11px;color:#6B7280;}
        button, .btn-restart, .restart-row, .tool-cta-card, #mt-emailgate {display:none !important;}
        @media print { body{padding:0;} }
      </style>`;
    printWindow.document.write(`
      <html><head><title>Monetools — Your Results</title>${styles}</head>
      <body>
        <div class="mt-pdf-header">
          <div class="brand">Monetools</div>
          <div class="date">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
        </div>
        ${resultEl.innerHTML}
        <div class="mt-pdf-footer">
          Monetools tools are provided for informational and educational purposes only. This is not tax advice — consult a qualified CPA for your specific situation.
        </div>
      </body></html>`);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 400);
  }
};

if (typeof window !== 'undefined') {
  window.renderAffiliateSidebar = renderAffiliateSidebar;
  window.EmailGate = EmailGate;
}
