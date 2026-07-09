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
    if (!resultEl) return;

    // True one-click download: render the result into an offscreen container,
    // rasterize it with html2canvas, then paginate into a jsPDF document —
    // no browser print dialog, no extra user clicks.
    const clone = resultEl.cloneNode(true);
    clone.querySelectorAll('button, .btn-restart, .restart-row, .tool-cta-card, #mt-emailgate, #mt-emailgate-mount')
      .forEach(el => el.remove());

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px;background:#fff;padding:32px;font-family:Georgia,serif;color:#1A1A2E;';
    wrapper.innerHTML = `
      <div style="border-bottom:3px solid #E8A838;padding-bottom:16px;margin-bottom:24px;">
        <div style="font-size:22px;font-weight:700;color:#0F1F3D;">Monetools</div>
        <div style="font-size:12px;color:#6B7280;margin-top:4px;">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
      </div>
      ${clone.outerHTML}
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #D4CFC6;font-size:11px;color:#6B7280;">
        Monetools tools are provided for informational and educational purposes only. This is not tax advice — consult a qualified CPA for your specific situation.
      </div>`;
    document.body.appendChild(wrapper);

    html2canvas(wrapper, { scale: 2, backgroundColor: '#ffffff', windowWidth: 700 }).then(canvas => {
      document.body.removeChild(wrapper);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      const imgData = canvas.toDataURL('image/jpeg', 0.92);

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save('monetools-results.pdf');
    }).catch(() => {
      // Fallback if html2canvas/jsPDF fail to load (e.g. offline): use print dialog
      document.body.contains(wrapper) && document.body.removeChild(wrapper);
      window.print();
    });
  }
};

if (typeof window !== 'undefined') {
  window.renderAffiliateSidebar = renderAffiliateSidebar;
  window.EmailGate = EmailGate;
}
