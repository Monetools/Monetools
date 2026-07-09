/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS — AFFILIATE LINKS & TOOL-SLOT CONFIG (Central Config)
 * ═══════════════════════════════════════════════════════════
 * ONE FILE TO EDIT. All 11 tools read from this file.
 *
 * TWO THINGS YOU CONTROL HERE:
 *   1. AFFILIATE_LINKS — the actual partner name + URL for each category.
 *      Fill in "url" once you have a real affiliate link. Leave url: null
 *      and that category simply won't render anywhere (no broken links).
 *   2. TOOL_SIDEBAR_SLOTS — which categories show up on which tool page,
 *      in what order. Change the array for any tool anytime — no need
 *      to touch that tool's HTML file at all.
 * ═══════════════════════════════════════════════════════════
 */

const AFFILIATE_LINKS = {
  llcFormation: {
    name: "ZenBusiness",
    blurb: "Form your LLC online in ~10 minutes, with registered agent service included.",
    url: null   // fill in once you have the affiliate link
  },
  businessBanking: {
    name: "Mercury",
    blurb: "Free business banking built for freelancers and small business owners.",
    url: null
  },
  payroll: {
    name: "Gusto",
    blurb: "Run payroll and file S-Corp reasonable salary paperwork automatically.",
    url: null
  },
  bookkeeping: {
    name: "Keeper Tax",
    blurb: "AI-powered bookkeeping that finds deductions and preps your Schedule C automatically.",
    url: null
  },
  cpaReferral: {
    name: "Book a CPA",
    blurb: "Get a 15-minute diagnostic call to review your specific tax situation.",
    url: null
  },
  mileageTracker: {
    name: "Stride",
    blurb: "Free automatic mileage tracking for gig workers and freelancers.",
    url: null
  }
};

/*
 * Which affiliate slots appear on each tool, and in what order.
 * Add/remove/reorder categories any time — this is the ONLY place to edit.
 * Tool identifier = the HTML filename without ".html"
 */
const TOOL_SIDEBAR_SLOTS = {
  "should-i-form-an-llc":        ["llcFormation", "businessBanking"],
  "llc-vs-s-corp":                ["payroll", "bookkeeping"],
  "quarterly-tax-estimator":      ["bookkeeping", "businessBanking"],
  "true-hourly-rate":              ["bookkeeping", "businessBanking"],
  "s-corp-readiness":              ["payroll", "cpaReferral"],

  "side-hustle-tax-calculator":    ["bookkeeping", "mileageTracker"],
  "gig-worker-calculator":         ["mileageTracker", "bookkeeping"],
  "quit-calculator":               ["businessBanking", "cpaReferral"],

  "landlord-tax-estimator":        ["cpaReferral", "bookkeeping"],
  "str-host-tax-tool":             ["cpaReferral", "bookkeeping"],
  "sell-vs-keep-calculator":       ["cpaReferral", "llcFormation"]
};

if (typeof window !== 'undefined') {
  window.AFFILIATE_LINKS = AFFILIATE_LINKS;
  window.TOOL_SIDEBAR_SLOTS = TOOL_SIDEBAR_SLOTS;
}
