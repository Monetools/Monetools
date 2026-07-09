/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS — 2026 FEDERAL TAX CONSTANTS (Central Config)
 * ═══════════════════════════════════════════════════════════
 * ONE FILE TO UPDATE EACH YEAR. All 11 tools read from this file.
 * When IRS releases new Rev. Proc. figures each year:
 *   1. Update TAX_YEAR and every number below
 *   2. Update the "lastUpdated" and "source" fields
 *   3. Do NOT touch any tool's HTML/JS — they all read from here
 *
 * Source for 2026 figures: IRS Rev. Proc. 2025-32, IRS Pub 527/925/946
 * Last updated: July 2026
 * ═══════════════════════════════════════════════════════════
 */

const TAX_CONSTANTS = {

  meta: {
    taxYear: 2026,
    lastUpdated: "2026-07-08",
    source: "IRS Rev. Proc. 2025-32; IRS Publications 527, 925, 946, 334"
  },

  // ─────────────────────────────────────────────
  // SHARED — used by Self-Employed + Side Hustler + Landlord tools
  // ─────────────────────────────────────────────
  shared: {
    standardDeduction: {
      single: 16100,
      mfj: 32200,
      hoh: 24150
    },

    // Ordinary federal income tax brackets [upperLimit, rate]
    federalBrackets: {
      single: [[12400,0.10],[50400,0.12],[105700,0.22],[201775,0.24],[256225,0.32],[640600,0.35],[Infinity,0.37]],
      mfj:    [[24800,0.10],[100800,0.12],[211400,0.22],[403550,0.24],[512450,0.32],[768700,0.35],[Infinity,0.37]],
      hoh:    [[18750,0.10],[50250,0.12],[100600,0.22],[176900,0.24],[229600,0.32],[640600,0.35],[Infinity,0.37]]
    },

    // Long-term capital gains brackets [upperLimit, rate]
    ltcgBrackets: {
      single: [[49450,0],[545500,0.15],[Infinity,0.20]],
      mfj:    [[98900,0],[613700,0.15],[Infinity,0.20]],
      hoh:    [[66200,0],[579600,0.15],[Infinity,0.20]]
    },

    seTax: {
      rate: 0.153,              // 15.3% total (12.4% SS + 2.9% Medicare)
      ssRate: 0.124,
      medicareRate: 0.029,
      netEarningsFactor: 0.9235, // multiply net profit by this before applying SE tax
      ssWageBase: 184500,        // 2026 Social Security wage base — SS portion capped here
      addlMedicareRate: 0.009,   // Additional Medicare Tax above threshold
      addlMedicareThreshold: { single: 200000, mfj: 250000, hoh: 200000 }
    },

    qbi: {
      deductionRate: 0.20,
      phaseoutStart: { single: 203000, mfj: 406000, hoh: 203000 }
    },

    niit: {
      rate: 0.038,
      threshold: { single: 200000, mfj: 250000, hoh: 200000 }
    },

    mileageRate: 0.725,          // IRS standard mileage rate, cents/mile expressed as dollars

    quarterlyDeadlines2026: [
      "April 15, 2026",
      "June 16, 2026",
      "September 15, 2026",
      "January 15, 2027"
    ],

    safeHarbor: {
      standardPct: 1.00,          // 100% of prior year tax, if prior AGI <= threshold
      highIncomePct: 1.10,        // 110% of prior year tax, if prior AGI > threshold
      highIncomeAGIThreshold: 150000
    },

    deMinimisSafeHarbor: 2500     // per-invoice expensing threshold
  },

  // ─────────────────────────────────────────────
  // SELF-EMPLOYED tools specific
  // ─────────────────────────────────────────────
  selfEmployed: {
    solo401k: {
      employeeLimit: 24500,
      totalLimit: 72000
    },
    section179Limit: 2500000,
    saltCap: 40000,
    tipDeductionMax: 25000,       // OBBBA qualifying tips deduction (2025-2028)
    tipDeductionYears: "2025–2028"
  },

  // ─────────────────────────────────────────────
  // LANDLORD tools specific
  // ─────────────────────────────────────────────
  landlord: {
    depreciationYears: 27.5,               // residential rental, straight-line
    depreciationRecaptureRate: 0.25,        // max unrecaptured Section 1250 gain rate
    passiveLossAllowance: 25000,
    passiveLossPhaseoutStart: 100000,
    passiveLossPhaseoutEnd: 150000,
    sellingCostPct: 0.07,                   // estimate used in Sell vs Keep calculator
    section121Exclusion: { single: 250000, mfj: 500000 }, // primary residence gain exclusion
  },

  // ─────────────────────────────────────────────
  // SHORT-TERM RENTAL / AIRBNB classifier specific
  // ─────────────────────────────────────────────
  strHost: {
    fourteenDayRuleMaxRentedDays: 14,       // IRC §280A(g) "Masters Rule"
    fourteenDayRuleMinPersonalDays: 14,
    vacationHomeMinPersonalDays: 14,        // greater of 14 days or 10% of rental days
    vacationHomeRentalDaysPct: 0.10,
    strLoopholeAvgStayMaxDays: 7,           // average stay ≤7 days test (IRC §469)
    materialParticipationHours: 100,
    form1099kThreshold: 20000,
    form1099kTransactions: 200
  }

};

// ─────────────────────────────────────────────
// SHARED CALCULATION HELPERS (so every tool computes identically)
// ─────────────────────────────────────────────
const TaxCalc = {
  fmt(n) { return '$' + Math.round(Math.abs(n)).toLocaleString(); },

  ordinaryTax(taxableIncome, filing) {
    const brackets = TAX_CONSTANTS.shared.federalBrackets[filing] || TAX_CONSTANTS.shared.federalBrackets.single;
    let tax = 0, prev = 0;
    for (const [limit, rate] of brackets) {
      if (taxableIncome <= prev) break;
      tax += (Math.min(taxableIncome, limit) - prev) * rate;
      prev = limit;
    }
    return Math.max(0, tax);
  },

  marginalRate(taxableIncome, filing) {
    const brackets = TAX_CONSTANTS.shared.federalBrackets[filing] || TAX_CONSTANTS.shared.federalBrackets.single;
    for (const [limit, rate] of brackets) { if (taxableIncome <= limit) return rate; }
    return 0.37;
  },

  ltcgRate(taxableIncome, filing) {
    const brackets = TAX_CONSTANTS.shared.ltcgBrackets[filing] || TAX_CONSTANTS.shared.ltcgBrackets.single;
    for (const [limit, rate] of brackets) { if (taxableIncome <= limit) return rate; }
    return 0.20;
  },

  seTax(netProfit) {
    const c = TAX_CONSTANTS.shared.seTax;
    const base = netProfit * c.netEarningsFactor;
    return Math.min(base, c.ssWageBase) * c.ssRate + base * c.medicareRate;
  },

  qbiDeduction(netIncome, totalTaxableIncome, filing) {
    const c = TAX_CONSTANTS.shared.qbi;
    const threshold = c.phaseoutStart[filing] || c.phaseoutStart.single;
    return totalTaxableIncome < threshold ? netIncome * c.deductionRate : 0;
  },

  niitOwed(magiWithGain, filing, netInvestmentIncome) {
    const c = TAX_CONSTANTS.shared.niit;
    const threshold = c.threshold[filing] || c.threshold.single;
    if (magiWithGain <= threshold) return 0;
    const base = Math.min(netInvestmentIncome, magiWithGain - threshold);
    return base * c.rate;
  }
};

// Make available to browser (tools load this as a plain <script> tag)
if (typeof window !== 'undefined') {
  window.TAX_CONSTANTS = TAX_CONSTANTS;
  window.TaxCalc = TaxCalc;
}
