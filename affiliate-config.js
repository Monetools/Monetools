/* ============================================================
   MONETOOLS — AFFILIATE LINKS CONFIGURATION
   ============================================================
   This is the ONLY file you need to edit to add, change, or
   remove affiliate links across the entire site.

   HOW TO USE:
   1. Get your affiliate link from the partner program
      (e.g. ZenBusiness, Gusto, Mercury, Keeper Tax)
   2. Paste it as the value (between the quotes) below
   3. Save this file and upload it to replace the old one
   4. Done — all 5 tools automatically use the new link.
      You do NOT need to touch any tool's HTML/code file.

   If a link is not ready yet, leave it as null (no quotes).
   The tools will automatically fall back to a plain text
   description with no link until you fill it in.
   ============================================================ */

const AFFILIATE_LINKS = {

  // ------------------------------------------------------------
  // Used in: should-i-form-an-llc.html
  // Shown when: result recommends forming an LLC now
  // ------------------------------------------------------------
  llcFormation: {
    name: "ZenBusiness",
    url: null,  // PASTE_ZENBUSINESS_LINK_HERE
    description: "LLC formation starting at $0 + state fees, 2-day filing"
  },

  // ------------------------------------------------------------
  // Used in: should-i-form-an-llc.html (secondary recommendation,
  // shown after LLC formation step, "next thing to do")
  // ------------------------------------------------------------
  businessBanking: {
    name: "Mercury",
    url: null,  // PASTE_MERCURY_OR_RELAY_LINK_HERE
    description: "Free business banking, no minimums, opens in 10 minutes"
  },

  // ------------------------------------------------------------
  // Used in: llc-vs-s-corp.html
  // Shown when: result recommends electing S-Corp
  // ------------------------------------------------------------
  payroll: {
    name: "Gusto",
    url: null,  // PASTE_GUSTO_LINK_HERE
    description: "Payroll software for S-Corp owners, from $40/month"
  },

  // ------------------------------------------------------------
  // Used in: quarterly-tax-estimator.html
  // Shown when: any result (optional secondary recommendation)
  // ------------------------------------------------------------
  bookkeeping: {
    name: "Keeper Tax",
    url: null,  // PASTE_KEEPER_TAX_LINK_HERE (optional, can stay null)
    description: "Automatic expense tracking and tax filing for freelancers"
  },

  // ------------------------------------------------------------
  // Used in: s-corp-readiness.html
  // Shown when: result indicates user needs a CPA
  // Currently no partner — leave null until you have one
  // ------------------------------------------------------------
  cpaReferral: {
    name: "",
    url: null,
    description: ""
  }

};

/* ============================================================
   HELPER FUNCTION — do not edit below this line
   Renders a recommendation block. If url is null, shows plain
   text with no link (so nothing ever looks broken).
   ============================================================ */
function renderAffiliateBlock(key) {
  const item = AFFILIATE_LINKS[key];
  if (!item) return '';

  if (item.url) {
    return `
      <a href="${item.url}" target="_blank" rel="noopener sponsored" class="affiliate-block">
        <div class="affiliate-block-name">${item.name} →</div>
        <div class="affiliate-block-desc">${item.description}</div>
      </a>`;
  } else {
    // No link yet — show as plain informational text, not clickable
    return `
      <div class="affiliate-block affiliate-block-pending">
        <div class="affiliate-block-name">${item.name}</div>
        <div class="affiliate-block-desc">${item.description}</div>
      </div>`;
  }
}
