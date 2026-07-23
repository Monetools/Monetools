/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/self-employed/quarterly-tax-estimator.html
 * ═══════════════════════════════════════════════════════════
 * This tool now reads TAX_CONSTANTS/TaxCalc from the central config
 * (config/tax-constants-2026.js), same as it does in the browser — so this
 * harness loads that file into the sandbox FIRST, then runs the tool's
 * script on top of it, exactly mirroring the real <script src=...> load
 * order in post.njk / the tool's own <head>.
 *
 * USAGE: node test-quarterly-tax-estimator.js [path-to-html] [path-to-config-js]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'self-employed', 'quarterly-tax-estimator.html');
const CONFIG_FILE = process.argv[3] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'config', 'tax-constants-2026.js');

function runCalcTax(htmlPath, configPath, d) {
  const configSrc = fs.readFileSync(configPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const target = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function calcTax'));
  if (!target) throw new Error('Could not find calcTax() — has the tool\'s structure changed?');

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(configSrc, sandbox);
  const runner = target + `
    d.gross = ${JSON.stringify(d.gross)};
    d.expenses = ${JSON.stringify(d.expenses)};
    d.filing = ${JSON.stringify(d.filing)};
    d.otherIncome = ${JSON.stringify(d.otherIncome)};
    d.state = ${JSON.stringify(d.state)};
    d.paid = ${JSON.stringify(d.paid)};
    var __qaResult = calcTax();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

function loadConstants(configPath) {
  const sandbox = {};
  vm.createContext(sandbox);
  const runner = fs.readFileSync(configPath, 'utf8') + '\nvar __qaConstants = TAX_CONSTANTS;';
  vm.runInContext(runner, sandbox);
  return sandbox.__qaConstants;
}

function expectedResult(TC, d) {
  const net = Math.max(0, d.gross - d.expenses);
  const c = TC.shared.seTax;

  const seEarnings = net * c.netEarningsFactor;
  const seTax = Math.min(seEarnings, c.ssWageBase) * c.ssRate + seEarnings * c.medicareRate;

  const otherAdj = { none: 0, low: 25000, high: 75000 }[d.otherIncome] || 0;
  const addlThreshold = c.addlMedicareThreshold[d.filing] || c.addlMedicareThreshold.single;
  const combinedEarnings = seEarnings + otherAdj;
  const addlMedicareTax = Math.max(0, combinedEarnings - addlThreshold) * c.addlMedicareRate;

  const stdDed = TC.shared.standardDeduction[d.filing] || TC.shared.standardDeduction.single;

  const qbiLimit = TC.shared.qbi.phaseoutStart[d.filing] || TC.shared.qbi.phaseoutStart.single;
  const preQbiTaxable = Math.max(0, net - seTax * 0.5 + otherAdj - stdDed);
  const qbiDeduction = preQbiTaxable > qbiLimit ? 0 : Math.min(net * TC.shared.qbi.deductionRate, preQbiTaxable * TC.shared.qbi.deductionRate);

  const taxableIncome = Math.max(0, preQbiTaxable - qbiDeduction);

  const brackets = TC.shared.federalBrackets[d.filing] || TC.shared.federalBrackets.single;
  let fedIncomeTax = 0, prev = 0;
  for (const [limit, rate] of brackets) {
    if (taxableIncome <= prev) break;
    fedIncomeTax += (Math.min(taxableIncome, limit) - prev) * rate;
    prev = limit;
  }

  const stateRate = { none: 0, low: 0.04, mid: 0.06, high: 0.10 }[d.state] || 0;
  const stateTax = net * stateRate;

  const totalAnnual = seTax + addlMedicareTax + fedIncomeTax + stateTax;

  return {
    seTax: Math.round(seTax), addlMedicareTax: Math.round(addlMedicareTax),
    fedIncomeTax: Math.round(fedIncomeTax), stateTax: Math.round(stateTax),
    totalAnnual: Math.round(totalAnnual)
  };
}

function roundResult(r) {
  return {
    seTax: Math.round(r.seTax), addlMedicareTax: Math.round(r.addlMedicareTax),
    fedIncomeTax: Math.round(r.fedIncomeTax), stateTax: Math.round(r.stateTax),
    totalAnnual: Math.round(r.totalAnnual)
  };
}

const cases = [
  { name: 'Low income, single, no other income',        gross: 40000,  expenses: 8000,  filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'Typical freelancer, single',                  gross: 90000,  expenses: 15000, filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'MFJ with spouse W-2 income (low)',             gross: 90000,  expenses: 15000, filing: 'mfj',    otherIncome: 'low',  state: 'mid', paid: 'none' },
  { name: 'MFJ with spouse W-2 income (high)',            gross: 150000, expenses: 20000, filing: 'mfj',    otherIncome: 'high', state: 'mid', paid: 'none' },
  { name: 'HOH filer',                                    gross: 70000,  expenses: 10000, filing: 'hoh',    otherIncome: 'none', state: 'low', paid: 'none' },
  { name: 'High earner single, triggers Addl Medicare',   gross: 300000, expenses: 20000, filing: 'single', otherIncome: 'none', state: 'high', paid: 'none' },
  { name: 'High earner MFJ, triggers Addl Medicare',      gross: 400000, expenses: 30000, filing: 'mfj',    otherIncome: 'high', state: 'high', paid: 'none' },
  { name: 'QBI phase-out zone (single, very high income)', gross: 350000, expenses: 10000, filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'No state tax',                                 gross: 90000,  expenses: 15000, filing: 'single', otherIncome: 'none', state: 'none', paid: 'none' },
  { name: 'Zero expenses',                                gross: 90000,  expenses: 0,     filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'Expenses exceed gross (net loss)',             gross: 30000,  expenses: 50000, filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'Zero gross income',                            gross: 0,      expenses: 0,     filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'No filing status selected (blank)',             gross: 90000,  expenses: 15000, filing: '',       otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'Already paid 2 quarters on target',             gross: 90000,  expenses: 15000, filing: 'single', otherIncome: 'none', state: 'mid', paid: 'ontarget' },
  { name: 'Astronomical income',                          gross: 5000000, expenses: 100000, filing: 'mfj',  otherIncome: 'high', state: 'high', paid: 'none' },
  { name: 'Just under SS wage base',                       gross: 200000, expenses: 10000, filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
  { name: 'Just over SS wage base',                        gross: 220000, expenses: 10000, filing: 'single', otherIncome: 'none', state: 'mid', paid: 'none' },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Quarterly Tax Estimator');
console.log('Testing file:', TARGET_FILE);
console.log('Config file:', CONFIG_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

const TC = loadConstants(CONFIG_FILE);
let passCount = 0, failCount = 0;

for (const tc of cases) {
  let result, error = null;
  try {
    result = runCalcTax(TARGET_FILE, CONFIG_FILE, tc);
  } catch (e) {
    error = e.message;
  }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const exp = expectedResult(TC, tc);
    const got = roundResult(result);
    for (const field of ['seTax', 'addlMedicareTax', 'fedIncomeTax', 'stateTax', 'totalAnnual']) {
      if (got[field] !== exp[field]) {
        status = 'FAIL';
        notes.push(`${field} mismatch — tool: ${got[field]}, expected: ${exp[field]}`);
      }
    }
    if (tc.expenses > tc.gross) {
      if (result.isNetLoss === true && result.totalAnnual === 0) {
        notes.push('✓ Net loss correctly clamped to $0 owed, flagged via isNetLoss.');
      } else {
        status = 'FAIL';
        notes.push(`⚠ Net loss not handled correctly — isNetLoss=${result.isNetLoss}, totalAnnual=${result.totalAnnual} (expected 0).`);
      }
    }
    if (tc.gross === 0 && status === 'PASS') {
      notes.push('ℹ Zero income: totalAnnual=' + result.totalAnnual + '. No crash, no validation message shown.');
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         gross=$${tc.gross.toLocaleString()} expenses=$${tc.expenses.toLocaleString()} filing=${tc.filing||'∅'} otherIncome=${tc.otherIncome} state=${tc.state}`);
    console.log(`         tool: seTax=${Math.round(result.seTax)} addlMedicare=${Math.round(result.addlMedicareTax)} fedIncomeTax=${Math.round(result.fedIncomeTax)} stateTax=${Math.round(result.stateTax)} totalAnnual=${Math.round(result.totalAnnual)}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
