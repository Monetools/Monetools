/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/self-employed/true-hourly-rate.html
 * ═══════════════════════════════════════════════════════════
 * Quirk specific to this tool: getBenefitValue() (called inside calcRate())
 * reads directly from the DOM (a checkbox + slider) instead of the `d`
 * state object. So this harness stubs a minimal `document.getElementById`
 * to simulate the "include lost benefits" toggle being on/off.
 *
 * USAGE: node test-true-hourly-rate.js [path-to-html]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'self-employed', 'true-hourly-rate.html');

function makeDocumentStub(benefitChecked, benefitValue) {
  const elements = {
    'benefit-check': { checked: benefitChecked },
    'benefit-sl': { value: String(benefitValue) }
  };
  return {
    getElementById(id) {
      if (elements[id]) return elements[id];
      return { checked: false, value: '0', style: {}, innerHTML: '', textContent: '' };
    }
  };
}

function runCalcRate(htmlPath, d, benefitChecked, benefitValue) {
  benefitChecked = benefitChecked || false;
  benefitValue = benefitValue || 0;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const target = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function calcRate'));
  if (!target) throw new Error('Could not find calcRate() — has the tool\'s structure changed?');

  const sandbox = { document: makeDocumentStub(benefitChecked, benefitValue) };
  vm.createContext(sandbox);
  const runner = target + `
    d.rate = ${JSON.stringify(d.rate)};
    d.billable = ${JSON.stringify(d.billable)};
    d.total = ${JSON.stringify(d.total)};
    d.expenses = ${JSON.stringify(d.expenses)};
    d.taxBracket = ${JSON.stringify(d.taxBracket)};
    d.weeksOff = ${JSON.stringify(d.weeksOff)};
    var __qaResult = calcRate();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

function expectedResult(d) {
  const quotedRate = d.rate;
  const billable = d.billable;
  const total = d.total || billable;
  const weeksOff = parseInt(d.weeksOff) || 4;
  const weeksWorked = 52 - weeksOff;
  const annualExp = d.expenses * 12;
  const taxRate = { low: 0.30, mid: 0.355, high: 0.42 }[d.taxBracket] || 0.355;

  const annualGross = quotedRate * billable * weeksWorked;
  const afterExp = annualGross - annualExp;

  const QBI_PHASEOUT = 203000;
  const qbiEligible = afterExp <= QBI_PHASEOUT;
  const qbiDeduction = qbiEligible ? Math.max(0, afterExp) * 0.20 : 0;
  const taxableBase = Math.max(0, afterExp - qbiDeduction);

  const ADDL_MEDICARE_THRESHOLD = 200000;
  const addlMedicareTax = Math.max(0, afterExp - ADDL_MEDICARE_THRESHOLD) * 0.009;

  const annualNet = (taxableBase * (1 - taxRate)) + (afterExp - taxableBase) - addlMedicareTax;
  const totalHoursWorked = total * weeksWorked;
  const trueHourly = totalHoursWorked > 0 ? annualNet / totalHoursWorked : 0;

  // THIS IS THE SUSPECTED BUG: the tool's `recommendedRate` calc uses a flat
  // `effectiveRate = taxRate * (1 - 0.20)` that ALWAYS assumes the 20% QBI
  // shield applies — even when `qbiEligible` is false elsewhere in the same
  // function. Our "correct" version gates the QBI shield consistently.
  const correctEffectiveRate = qbiEligible ? taxRate * (1 - 0.20) : taxRate;
  const targetAnnualNet = quotedRate * totalHoursWorked;
  const targetAfterExp = targetAnnualNet / (1 - correctEffectiveRate);
  const targetGross = targetAfterExp + annualExp;
  const correctRecommendedRate = billable * weeksWorked > 0 ? targetGross / (billable * weeksWorked) : 0;

  return { trueHourly, correctRecommendedRate, qbiEligible, afterExp };
}

const cases = [
  { name: 'Typical freelancer', rate: 75, billable: 25, total: 35, expenses: 500, taxBracket: 'mid', weeksOff: 4 },
  { name: 'Low tax bracket',    rate: 50, billable: 20, total: 30, expenses: 300, taxBracket: 'low', weeksOff: 4 },
  { name: 'High tax bracket, high income (QBI phase-out zone)', rate: 400, billable: 30, total: 35, expenses: 2000, taxBracket: 'high', weeksOff: 4 },
  { name: 'Very high income, well past QBI phase-out', rate: 600, billable: 35, total: 40, expenses: 3000, taxBracket: 'high', weeksOff: 2 },
  { name: 'Low utilization (lots of unpaid hours)', rate: 80, billable: 15, total: 40, expenses: 500, taxBracket: 'mid', weeksOff: 4 },
  { name: 'No weeks off specified (defaults to 4)', rate: 75, billable: 25, total: 35, expenses: 500, taxBracket: 'mid', weeksOff: '' },
  { name: 'Total hours = billable hours (no unpaid time)', rate: 75, billable: 30, total: 30, expenses: 500, taxBracket: 'mid', weeksOff: 4 },
  { name: 'Zero expenses', rate: 75, billable: 25, total: 35, expenses: 0, taxBracket: 'mid', weeksOff: 4 },
  { name: 'Very low rate/hours', rate: 10, billable: 5, total: 10, expenses: 0, taxBracket: 'low', weeksOff: 4 },
];

const benefitCases = [
  { name: 'Benefit toggle ON with $8,000/yr gap', base: cases[0], benefitChecked: true, benefitValue: 8000 },
  { name: 'Benefit toggle OFF (should not affect trueHourly)', base: cases[0], benefitChecked: false, benefitValue: 8000 },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — True Hourly Rate Calculator');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;

for (const tc of cases) {
  let result, error = null;
  try {
    result = runCalcRate(TARGET_FILE, tc);
  } catch (e) {
    error = e.message;
  }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const exp = expectedResult(tc);
    if (Math.round(result.trueHourly) !== Math.round(exp.trueHourly)) {
      status = 'FAIL';
      notes.push(`trueHourly mismatch — tool: ${result.trueHourly.toFixed(2)}, expected: ${exp.trueHourly.toFixed(2)}`);
    }
    if (Math.round(result.recommendedRate) !== Math.round(exp.correctRecommendedRate)) {
      status = 'FAIL';
      notes.push(`recommendedRate mismatch — tool: ${result.recommendedRate.toFixed(2)}, correctly QBI-gated: ${exp.correctRecommendedRate.toFixed(2)}` +
        (exp.qbiEligible ? '' : `  ⚠ afterExp=$${Math.round(exp.afterExp).toLocaleString()} is in the QBI phase-out zone — tool's recommendedRate wrongly assumes the 20% QBI shield still applies.`));
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         rate=$${tc.rate} billable=${tc.billable}h total=${tc.total}h expenses=$${tc.expenses}/mo bracket=${tc.taxBracket}`);
    console.log(`         trueHourly=${result.trueHourly.toFixed(2)}  recommendedRate=${result.recommendedRate.toFixed(2)}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('── Benefit-gap toggle checks (informational) ──\n');
for (const bc of benefitCases) {
  const r = runCalcRate(TARGET_FILE, bc.base, bc.benefitChecked, bc.benefitValue);
  console.log(`[INFO ] ${bc.name}`);
  console.log(`         trueHourly=${r.trueHourly.toFixed(2)}  trueHourlyWithBenefit=${r.trueHourlyWithBenefit.toFixed(2)}  benefitGap=${r.benefitGap}`);
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
